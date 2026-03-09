/**
 * index.js - Cloudflare Worker 主入口
 * 处理 HTTP API 路由 + WebSocket 升级到 Durable Object
 */

export { GameRoom } from './game-room.js';

export default {
  // Cron Trigger：定期清理旧数据（需在 wrangler.toml 配置）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleDataCleanup(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return corsResponse();
    }

    try {
      // ==================== API 路由 ====================

      // 创建/获取玩家
      if (path === '/api/player' && request.method === 'POST') {
        return cors(await handleCreatePlayer(request, env));
      }

      if (path === '/api/player' && request.method === 'GET') {
        const playerId = url.searchParams.get('id');
        return cors(await handleGetPlayer(playerId, env));
      }

      // 匹配队列
      if (path === '/api/matchmaking' && request.method === 'POST') {
        return cors(await handleMatchmaking(request, env));
      }

      // 房间列表
      if (path === '/api/rooms' && request.method === 'GET') {
        return cors(await handleListRooms(env));
      }

      // 创建房间
      if (path === '/api/rooms' && request.method === 'POST') {
        return cors(await handleCreateRoom(request, env));
      }

      // 排行榜
      if (path === '/api/leaderboard') {
        return cors(await handleLeaderboard(env));
      }

      // 数据清理（由 cron trigger 或手动调用）
      if (path === '/api/admin/cleanup' && request.method === 'POST') {
        return cors(await handleDataCleanup(env));
      }

      // 游戏历史
      if (path.startsWith('/api/history/')) {
        const playerId = path.split('/api/history/')[1];
        return cors(await handleGameHistory(playerId, env));
      }

      // WebSocket 连接到游戏房间
      if (path.startsWith('/api/rooms/') && path.endsWith('/ws')) {
        const roomId = path.split('/api/rooms/')[1].replace('/ws', '');
        return handleRoomWebSocket(request, env, roomId);
      }

      // 获取房间状态
      if (path.startsWith('/api/rooms/') && path.endsWith('/state')) {
        const roomId = path.split('/api/rooms/')[1].replace('/state', '');
        return cors(await handleRoomState(env, roomId));
      }

      // 不匹配任何API路由 → 交给 assets 处理 (index.html等)
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('Worker error:', err);
      return cors(Response.json({ error: err.message }, { status: 500 }));
    }
  },
};

// ==================== 处理函数 ====================

async function handleCreatePlayer(request, env) {
  const { name, id: existingId } = await request.json();
  if (!name || name.length > 20) {
    return Response.json({ error: '名称无效' }, { status: 400 });
  }

  // 已有 ID → 更新名字，保留积分
  if (existingId) {
    try {
      const row = await env.DB.prepare(
        'SELECT * FROM players WHERE id = ?'
      ).bind(existingId).first();
      if (row) {
        await env.DB.prepare(
          'UPDATE players SET name = ?, last_seen = datetime(\'now\') WHERE id = ?'
        ).bind(name, existingId).run();
        // 更新 KV
        await env.SESSIONS.put(`player:${existingId}`, JSON.stringify({
          id: existingId, name, rating: row.rating, games_played: row.games_played,
          games_won: row.games_won, createdAt: Date.now(),
        }), { expirationTtl: 86400 * 30 });
        return Response.json({ id: existingId, name, rating: row.rating });
      }
    } catch (e) {
      console.error('DB update error:', e);
    }
    // DB 中找不到 → 尝试 KV
    const cached = await env.SESSIONS.get(`player:${existingId}`, 'json');
    if (cached) {
      cached.name = name;
      await env.SESSIONS.put(`player:${existingId}`, JSON.stringify(cached), { expirationTtl: 86400 * 30 });
      return Response.json({ id: existingId, name, rating: cached.rating ?? 1000 });
    }
  }

  // 新玩家
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO players (id, name) VALUES (?, ?)'
    ).bind(id, name).run();
  } catch (e) {
    console.error('DB error:', e);
  }

  await env.SESSIONS.put(`player:${id}`, JSON.stringify({ id, name, rating: 1000, games_played: 0, games_won: 0, createdAt: Date.now() }), {
    expirationTtl: 86400 * 30,
  });

  return Response.json({ id, name, rating: 1000 });
}

async function handleGetPlayer(playerId, env) {
  if (!playerId) return Response.json({ error: '缺少ID' }, { status: 400 });

  // 优先从 DB 获取最新数据（rating 源）
  try {
    const row = await env.DB.prepare(
      'SELECT * FROM players WHERE id = ?'
    ).bind(playerId).first();
    if (row) return Response.json(row);
  } catch (e) { /* DB 不可用时 fallback KV */ }

  // DB 查不到或失败，尝试 KV
  const cached = await env.SESSIONS.get(`player:${playerId}`, 'json');
  if (cached) {
    // 确保返回的数据始终包含 rating
    return Response.json({
      id: cached.id,
      name: cached.name,
      rating: cached.rating ?? 1000,
      games_played: cached.games_played ?? 0,
      games_won: cached.games_won ?? 0,
    });
  }

  return Response.json({ error: '玩家不存在' }, { status: 404 });
}

async function handleMatchmaking(request, env) {
  const { playerId, playerName, mode = 'classic', playerCount = 2 } = await request.json();

  // 查找可用房间
  const queueKey = `queue:${mode}:${playerCount}`;
  const queue = await env.SESSIONS.get(queueKey, 'json') || [];

  // 清理过期条目 (30秒超时)
  const now = Date.now();
  const active = queue.filter(q => now - q.timestamp < 30000 && q.playerId !== playerId);

  if (active.length > 0) {
    // 找到匹配，加入房间
    const match = active[0];
    const remaining = active.slice(1);
    await env.SESSIONS.put(queueKey, JSON.stringify(remaining), { expirationTtl: 120 });
    return Response.json({ roomId: match.roomId, action: 'join' });
  }

  // 没有匹配，创建新房间等待
  const roomId = crypto.randomUUID().slice(0, 8);
  active.push({ playerId, playerName, roomId, mode, playerCount, timestamp: now });
  await env.SESSIONS.put(queueKey, JSON.stringify(active), { expirationTtl: 120 });

  return Response.json({ roomId, action: 'create' });
}

async function handleListRooms(env) {
  // 从KV获取活跃房间列表，过滤掉超过2小时的过时条目
  const list = await env.SESSIONS.get('rooms:active', 'json') || [];
  const now = Date.now();
  const fresh = list.filter(r => now - r.createdAt < 2 * 60 * 60 * 1000);
  // 如果有过时条目被清理，写回KV
  if (fresh.length !== list.length) {
    await env.SESSIONS.put('rooms:active', JSON.stringify(fresh), { expirationTtl: 3600 });
  }
  return Response.json({ rooms: fresh });
}

async function handleCreateRoom(request, env) {
  const data = await request.json();
  const roomId = data.roomId || crypto.randomUUID().slice(0, 8);

  // 记录活跃房间
  const rooms = await env.SESSIONS.get('rooms:active', 'json') || [];
  rooms.push({
    id: roomId,
    mode: data.mode || 'classic',
    playerCount: data.playerCount || 2,
    host: data.playerName || '未知',
    createdAt: Date.now(),
  });
  // 只保留最新50个
  await env.SESSIONS.put('rooms:active', JSON.stringify(rooms.slice(-50)), { expirationTtl: 3600 });

  return Response.json({ roomId });
}

async function handleLeaderboard(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, rating, games_played, games_won,
       CASE WHEN games_played > 0
         THEN ROUND(CAST(games_won AS REAL) / games_played * 100, 1)
         ELSE 0 END AS win_rate
       FROM players WHERE games_played >= 1 ORDER BY rating DESC LIMIT 50`
    ).all();
    return Response.json({ leaderboard: results || [] });
  } catch (e) {
    return Response.json({ leaderboard: [] });
  }
}

async function handleGameHistory(playerId, env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT g.id, g.mode, g.status, g.created_at, g.duration_seconds,
       gp.score, gp.result
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.player_id = ?
       ORDER BY g.created_at DESC LIMIT 20`
    ).bind(playerId).all();
    return Response.json({ history: results || [] });
  } catch (e) {
    return Response.json({ history: [] });
  }
}

async function handleDataCleanup(env) {
  const results = { games: 0, gamePlayers: 0, inactivePlayers: 0 };
  try {
    const db = env.DB;
    if (!db) return Response.json({ error: 'DB not available' }, { status: 503 });

    // 清理90天前的对局记录
    const r1 = await db.prepare(
      `DELETE FROM game_moves WHERE game_id IN (
        SELECT id FROM games WHERE finished_at < datetime('now', '-90 days')
      )`
    ).run();

    const r2 = await db.prepare(
      `DELETE FROM game_players WHERE game_id IN (
        SELECT id FROM games WHERE finished_at < datetime('now', '-90 days')
      )`
    ).run();
    results.gamePlayers = r2.meta?.changes || 0;

    const r3 = await db.prepare(
      `DELETE FROM games WHERE finished_at < datetime('now', '-90 days')`
    ).run();
    results.games = r3.meta?.changes || 0;

    // 清理180天未活跃且无对局记录的玩家
    const r4 = await db.prepare(
      `DELETE FROM players WHERE last_seen < datetime('now', '-180 days')
       AND games_played = 0`
    ).run();
    results.inactivePlayers = r4.meta?.changes || 0;

    return Response.json({ success: true, cleaned: results });
  } catch (e) {
    console.error('Cleanup error:', e);
    return Response.json({ error: e.message, partial: results }, { status: 500 });
  }
}

function handleRoomWebSocket(request, env, roomId) {
  const id = env.GAME_ROOM.idFromName(roomId);
  const room = env.GAME_ROOM.get(id);
  return room.fetch(request);
}

async function handleRoomState(env, roomId) {
  const id = env.GAME_ROOM.idFromName(roomId);
  const room = env.GAME_ROOM.get(id);
  const stateUrl = new URL(`https://room/state`);
  return room.fetch(new Request(stateUrl));
}

// ==================== CORS ====================

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function corsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function cors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}
