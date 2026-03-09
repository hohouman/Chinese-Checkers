/**
 * index.js - Cloudflare Worker 主入口
 * 处理 HTTP API 路由 + WebSocket 升级到 Durable Object
 */

export { GameRoom } from './game-room.js';

export default {
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
  const { name } = await request.json();
  if (!name || name.length > 20) {
    return Response.json({ error: '名称无效' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO players (id, name) VALUES (?, ?)'
    ).bind(id, name).run();
  } catch (e) {
    // DB不可用时仍可玩
    console.error('DB error:', e);
  }

  // 存入 KV 作为快速会话
  await env.SESSIONS.put(`player:${id}`, JSON.stringify({ id, name, createdAt: Date.now() }), {
    expirationTtl: 86400 * 30,
  });

  return Response.json({ id, name });
}

async function handleGetPlayer(playerId, env) {
  if (!playerId) return Response.json({ error: '缺少ID' }, { status: 400 });

  // 先查 KV
  const cached = await env.SESSIONS.get(`player:${playerId}`, 'json');
  if (cached) {
    // 从DB补充完整数据
    try {
      const row = await env.DB.prepare(
        'SELECT * FROM players WHERE id = ?'
      ).bind(playerId).first();
      if (row) return Response.json(row);
    } catch (e) { /* ignore */ }
    return Response.json(cached);
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
  // 从KV获取活跃房间列表
  const list = await env.SESSIONS.get('rooms:active', 'json') || [];
  return Response.json({ rooms: list });
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
