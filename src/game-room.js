/**
 * game-room.js - Durable Object: 游戏房间
 * 管理WebSocket连接、游戏状态、回合逻辑、AI对手
 */

import {
  generateStarBoard, cellKey, getHomeZone, getTargetZone,
  PLAYER_COLORS, PLAYER_POSITIONS, getZoneCells,
} from './game/board.js';
import {
  placeInitialPieces, resetPieceIdCounter, tickCooldowns,
  DEFAULT_PIECE_LOADOUT, PIECE_TYPES,
} from './game/pieces.js';
import { generateRandomTerrain, applyTerrainEffect, checkCollapseEvents } from './game/terrain.js';
import { getValidMoves, executeMove, executeMageAbility } from './game/rules.js';
import { shouldTriggerEvent, generateRandomEvent, executeEvent } from './game/events.js';
import { GAME_MODES, setupResourceCells, calculateTurnScores, checkVictory, getGameRanking } from './game/modes.js';
import { getAIMove, getAIMageAction } from './game/ai.js';

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // HTTP API 端点
    if (url.pathname.endsWith('/state')) {
      return this.handleGetState();
    }

    // WebSocket 升级
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    return new Response('Expected WebSocket or API call', { status: 400 });
  }

  async handleGetState() {
    const gs = await this.getGameState();
    if (!gs) return Response.json({ error: 'No game' }, { status: 404 });
    return Response.json(this.sanitizeState(gs));
  }

  async handleWebSocket(request, url) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const params = url.searchParams;
    const playerId = params.get('playerId') || crypto.randomUUID();
    const playerName = params.get('name') || '玩家';

    this.ctx.acceptWebSocket(server, [playerId]);

    // 发送初始状态
    const gs = await this.getGameState();
    if (gs) {
      server.send(JSON.stringify({
        type: 'gameState',
        state: this.sanitizeState(gs),
        yourId: playerId,
      }));
    } else {
      server.send(JSON.stringify({
        type: 'waiting',
        message: '等待创建游戏...',
        yourId: playerId,
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      const tags = this.ctx.getTags(ws);
      const playerId = tags[0];

      switch (data.type) {
        case 'createGame':
          await this.handleCreateGame(playerId, data);
          break;
        case 'joinGame':
          await this.handleJoinGame(playerId, data);
          break;
        case 'ready':
          await this.handleReady(playerId);
          break;
        case 'startGame':
          await this.handleStartGame(playerId);
          break;
        case 'move':
          await this.handleMove(playerId, data);
          break;
        case 'ability':
          await this.handleAbility(playerId, data);
          break;
        case 'endTurn':
          await this.handleEndTurn(playerId);
          break;
        case 'chat':
          this.broadcast({
            type: 'chat',
            playerId,
            message: data.message?.slice(0, 200),
            timestamp: Date.now(),
          });
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const tags = this.ctx.getTags(ws);
    const playerId = tags[0];
    const gs = await this.getGameState();
    if (gs) {
      const player = gs.players.find(p => p.id === playerId);
      if (player) {
        player.connected = false;
        await this.saveGameState(gs);
        this.broadcast({ type: 'playerDisconnected', playerId, name: player.name });
      }
    }
  }

  // ==================== 游戏流程处理 ====================

  async handleCreateGame(playerId, data) {
    const { mode = 'classic', playerCount = 2, playerName = '房主', config = {} } = data;
    const modeConfig = GAME_MODES[mode]?.defaultConfig || {};

    const gs = {
      id: crypto.randomUUID(),
      roomId: this.ctx.id.toString(),
      mode,
      status: 'waiting',
      turn: 0,
      currentPlayer: 0,
      playerCount,
      players: [],
      pieces: [],
      board: null,
      scores: {},
      config: { ...modeConfig, ...config },
      events: [],
      moveHistory: [],
      createdAt: Date.now(),
      extraTurn: false,
    };

    // 创建者自动加入
    const positions = PLAYER_POSITIONS[playerCount] || PLAYER_POSITIONS[2];
    gs.players.push({
      id: playerId,
      name: playerName,
      index: positions[0],
      color: PLAYER_COLORS[positions[0]],
      isAI: false,
      aiLevel: null,
      ready: false,
      connected: true,
      alive: true,
    });

    await this.saveGameState(gs);
    this.broadcast({
      type: 'gameCreated',
      state: this.sanitizeState(gs),
    });
  }

  async handleJoinGame(playerId, data) {
    const gs = await this.getGameState();
    if (!gs) return this.sendTo(playerId, { type: 'error', message: '房间不存在' });
    if (gs.status !== 'waiting') return this.sendTo(playerId, { type: 'error', message: '游戏已开始' });

    const { playerName = '玩家', isAI = false, aiLevel = 'medium' } = data;

    // AI 玩家使用独立生成的 ID，真人玩家使用 WebSocket 关联的 playerId
    const joinId = isAI ? `ai-${crypto.randomUUID()}` : playerId;

    // 检查是否已加入（仅对真人玩家检查）
    if (!isAI) {
      const existing = gs.players.find(p => p.id === playerId);
      if (existing) {
        existing.connected = true;
        await this.saveGameState(gs);
        this.sendTo(playerId, { type: 'gameState', state: this.sanitizeState(gs), yourId: playerId });
        return;
      }
    }

    const positions = PLAYER_POSITIONS[gs.playerCount] || PLAYER_POSITIONS[2];
    const takenIndices = gs.players.map(p => p.index);
    const nextIndex = positions.find(i => !takenIndices.includes(i));

    if (nextIndex === undefined) {
      return this.sendTo(playerId, { type: 'error', message: '房间已满' });
    }

    gs.players.push({
      id: joinId,
      name: playerName,
      index: nextIndex,
      color: PLAYER_COLORS[nextIndex],
      isAI,
      aiLevel: isAI ? aiLevel : null,
      ready: isAI,
      connected: !isAI,
      alive: true,
    });

    await this.saveGameState(gs);
    this.broadcast({
      type: 'playerJoined',
      player: { id: joinId, name: playerName, index: nextIndex, isAI },
      state: this.sanitizeState(gs),
    });
  }

  async handleReady(playerId) {
    const gs = await this.getGameState();
    if (!gs) return;
    const player = gs.players.find(p => p.id === playerId);
    if (player) {
      player.ready = !player.ready;
      await this.saveGameState(gs);
      this.broadcast({
        type: 'playerReady',
        playerId,
        ready: player.ready,
        state: this.sanitizeState(gs),
      });
    }
  }

  async handleStartGame(playerId) {
    const gs = await this.getGameState();
    if (!gs || gs.status !== 'waiting') return;

    // 检查所有人准备就绪
    const positions = PLAYER_POSITIONS[gs.playerCount] || PLAYER_POSITIONS[2];
    if (gs.players.length < 2) {
      return this.sendTo(playerId, { type: 'error', message: '至少需要2名玩家' });
    }

    const allReady = gs.players.every(p => p.ready || p.isAI);
    if (!allReady) {
      return this.sendTo(playerId, { type: 'error', message: '有玩家未准备' });
    }

    // 初始化棋盘
    resetPieceIdCounter();
    gs.board = generateStarBoard();

    // 放置地形
    if (gs.config.enableTerrain) {
      generateRandomTerrain(gs.board);
    }

    // 积分模式设置资源点
    if (gs.mode === 'points') {
      gs.resourceCells = setupResourceCells(gs.board, gs.config.resourceCellCount || 8);
    }

    // 放置棋子
    gs.pieces = [];
    for (const player of gs.players) {
      const homeZone = getHomeZone(player.index);
      const newPieces = placeInitialPieces(gs.board, player.index, homeZone, DEFAULT_PIECE_LOADOUT);
      gs.pieces.push(...newPieces);
    }

    // 初始化分数
    for (const player of gs.players) {
      gs.scores[player.index] = 0;
    }

    gs.status = 'playing';
    gs.turn = 1;
    gs.currentPlayer = gs.players[0].index;

    await this.saveGameState(gs);
    this.broadcast({
      type: 'gameStarted',
      state: this.sanitizeState(gs),
    });

    // 如果第一个玩家是AI，自动执行
    await this.processAITurn(gs);
  }

  async handleMove(playerId, data) {
    const gs = await this.getGameState();
    if (!gs || gs.status !== 'playing') return;

    const player = gs.players.find(p => p.id === playerId);
    if (!player || player.index !== gs.currentPlayer) {
      return this.sendTo(playerId, { type: 'error', message: '不是你的回合' });
    }

    const { pieceId, to } = data;
    const piece = gs.pieces.find(p => p.id === pieceId);
    if (!piece || piece.player !== player.index || !piece.active) {
      return this.sendTo(playerId, { type: 'error', message: '无效棋子' });
    }

    // 验证移动合法性
    const validMoves = getValidMoves(gs.board, gs.pieces, pieceId, gs.config);
    const targetMove = validMoves.find(m => m.to === to);
    if (!targetMove) {
      return this.sendTo(playerId, { type: 'error', message: '无效移动' });
    }

    // 执行移动
    const result = executeMove(gs.board, gs.pieces, pieceId, to, targetMove, gs.mode);
    if (!result.success) {
      return this.sendTo(playerId, { type: 'error', message: result.error });
    }

    // 记录历史
    gs.moveHistory.push({
      turn: gs.turn,
      player: player.index,
      pieceId,
      from: result.from,
      to: result.to,
      type: targetMove.type,
    });

    // 地形效果
    const terrainEffect = applyTerrainEffect(gs.board, to, targetMove.direction);

    if (terrainEffect.teleported && terrainEffect.teleportTo) {
      const teleFrom = to;
      const teleTo = terrainEffect.teleportTo;
      gs.board[teleFrom].piece = null;
      gs.board[teleTo].piece = piece.id;
      const teleCoords = gs.board[teleTo];
      piece.q = teleCoords.q;
      piece.r = teleCoords.r;
      result.effects.push({ type: 'teleport', from: teleFrom, to: teleTo });
    }

    if (terrainEffect.slid && terrainEffect.slideTo) {
      const slideFrom = terrainEffect.teleported ? terrainEffect.teleportTo : to;
      const slideTo = terrainEffect.slideTo;
      gs.board[slideFrom].piece = null;
      gs.board[slideTo].piece = piece.id;
      const slideCoords = gs.board[slideTo];
      piece.q = slideCoords.q;
      piece.r = slideCoords.r;
      result.effects.push({ type: 'slide', from: slideFrom, to: slideTo });
    }

    // 广播移动结果
    this.broadcast({
      type: 'moved',
      playerId,
      playerIndex: player.index,
      pieceId,
      from: result.from,
      to: result.to,
      moveType: targetMove.type,
      effects: result.effects,
      captured: result.captured,
      state: this.sanitizeState(gs),
    });

    // 检查是否有额外回合
    if (terrainEffect.extraTurn) {
      gs.extraTurn = true;
      await this.saveGameState(gs);
      this.broadcast({ type: 'extraTurn', playerIndex: player.index });
      return;
    }

    // 结束回合
    await this.advanceTurn(gs);
  }

  async handleAbility(playerId, data) {
    const gs = await this.getGameState();
    if (!gs || gs.status !== 'playing') return;

    const player = gs.players.find(p => p.id === playerId);
    if (!player || player.index !== gs.currentPlayer) {
      return this.sendTo(playerId, { type: 'error', message: '不是你的回合' });
    }

    const { pieceId, targetKey, terrain } = data;
    const piece = gs.pieces.find(p => p.id === pieceId);
    if (!piece || piece.player !== player.index) {
      return this.sendTo(playerId, { type: 'error', message: '无效棋子' });
    }

    if (piece.type === 'mage') {
      const result = executeMageAbility(gs.board, piece, targetKey, terrain || 'obstacle');
      if (!result.success) {
        return this.sendTo(playerId, { type: 'error', message: result.error });
      }

      this.broadcast({
        type: 'abilityUsed',
        pieceId,
        ability: 'terraform',
        targetKey,
        terrain: result.terrain,
        state: this.sanitizeState(gs),
      });

      await this.saveGameState(gs);
    }
  }

  async handleEndTurn(playerId) {
    const gs = await this.getGameState();
    if (!gs || gs.status !== 'playing') return;

    const player = gs.players.find(p => p.id === playerId);
    if (!player || player.index !== gs.currentPlayer) return;

    gs.extraTurn = false;
    await this.advanceTurn(gs);
  }

  // ==================== 游戏逻辑 ====================

  async advanceTurn(gs) {
    // 积分模式：计算本回合得分
    if (gs.mode === 'points') {
      const turnScores = calculateTurnScores(gs.board, gs.pieces, gs.players);
      for (const [idx, score] of Object.entries(turnScores)) {
        gs.scores[idx] = (gs.scores[idx] || 0) + score;
      }
      if (Object.values(turnScores).some(s => s > 0)) {
        this.broadcast({ type: 'scoresUpdated', scores: gs.scores, turnScores });
      }
    }

    // 检查胜利条件
    const victory = checkVictory(gs);
    if (victory) {
      gs.status = 'finished';
      gs.winner = victory.winner;
      const ranking = getGameRanking(gs);

      await this.saveGameState(gs);
      this.broadcast({
        type: 'gameOver',
        winner: victory.winner,
        reason: victory.reason,
        ranking,
        state: this.sanitizeState(gs),
      });

      // 保存到D1
      await this.saveGameResult(gs, ranking);
      return;
    }

    // 下一个玩家
    if (!gs.extraTurn) {
      const currentPlayerArrayIdx = gs.players.findIndex(p => p.index === gs.currentPlayer);
      let nextIdx = (currentPlayerArrayIdx + 1) % gs.players.length;

      // 跳过已淘汰的玩家
      let attempts = 0;
      while (!gs.players[nextIdx].alive && attempts < gs.players.length) {
        nextIdx = (nextIdx + 1) % gs.players.length;
        attempts++;
      }

      gs.currentPlayer = gs.players[nextIdx].index;

      // 如果回到第一个玩家，新回合
      if (nextIdx <= (currentPlayerArrayIdx % gs.players.length)) {
        gs.turn++;

        // 冷却减少
        tickCooldowns(gs.pieces);

        // 检查塌陷事件
        const collapsed = checkCollapseEvents(gs.board, gs.turn);
        if (collapsed.length > 0) {
          this.broadcast({ type: 'collapseEvent', collapsed, turn: gs.turn });
        }

        // 随机事件
        if (shouldTriggerEvent(gs.turn, gs.config)) {
          const event = generateRandomEvent(gs.board, gs.turn, gs.mode);
          if (event) {
            const changes = executeEvent(gs.board, gs.pieces, event);
            gs.events.push(event);
            this.broadcast({
              type: 'randomEvent',
              event: { ...event, changes },
              turn: gs.turn,
            });
          }
        }
      }
    }

    gs.extraTurn = false;
    await this.saveGameState(gs);

    this.broadcast({
      type: 'turnChanged',
      currentPlayer: gs.currentPlayer,
      turn: gs.turn,
      state: this.sanitizeState(gs),
    });

    // 处理AI回合
    await this.processAITurn(gs);
  }

  async processAITurn(gs) {
    const currentPlayer = gs.players.find(p => p.index === gs.currentPlayer);
    if (!currentPlayer || !currentPlayer.isAI || gs.status !== 'playing') return;

    // 延迟一下，模拟思考
    await new Promise(r => setTimeout(r, 800));

    const aiMove = getAIMove(
      gs.board, gs.pieces, currentPlayer.index,
      currentPlayer.aiLevel || 'medium', gs.mode, gs.config
    );

    if (!aiMove) {
      // AI无法移动，跳过回合
      this.broadcast({ type: 'aiSkip', playerIndex: currentPlayer.index });
      await this.advanceTurn(gs);
      return;
    }

    // 执行AI移动
    const result = executeMove(gs.board, gs.pieces, aiMove.pieceId, aiMove.move.to, aiMove.move, gs.mode);
    if (result.success) {
      gs.moveHistory.push({
        turn: gs.turn,
        player: currentPlayer.index,
        pieceId: aiMove.pieceId,
        from: result.from,
        to: result.to,
        type: aiMove.move.type,
      });

      // 处理地形效果
      const terrainEffect = applyTerrainEffect(gs.board, aiMove.move.to, aiMove.move.direction);
      const piece = gs.pieces.find(p => p.id === aiMove.pieceId);

      if (terrainEffect.teleported && terrainEffect.teleportTo && piece) {
        gs.board[aiMove.move.to].piece = null;
        gs.board[terrainEffect.teleportTo].piece = piece.id;
        const tc = gs.board[terrainEffect.teleportTo];
        piece.q = tc.q;
        piece.r = tc.r;
        result.effects.push({ type: 'teleport', from: aiMove.move.to, to: terrainEffect.teleportTo });
      }

      this.broadcast({
        type: 'moved',
        playerId: currentPlayer.id,
        playerIndex: currentPlayer.index,
        pieceId: aiMove.pieceId,
        from: result.from,
        to: aiMove.move.to,
        moveType: aiMove.move.type,
        effects: result.effects,
        captured: result.captured,
        isAI: true,
        state: this.sanitizeState(gs),
      });

      // AI 法师能力
      if (piece && piece.type === 'mage' && gs.config.enableAbilities) {
        const mageAction = getAIMageAction(gs.board, gs.pieces, piece, currentPlayer.index, gs.mode);
        if (mageAction) {
          const mageResult = executeMageAbility(gs.board, piece, mageAction.targetKey, mageAction.terrain);
          if (mageResult.success) {
            this.broadcast({
              type: 'abilityUsed',
              pieceId: piece.id,
              ability: 'terraform',
              targetKey: mageAction.targetKey,
              terrain: mageResult.terrain,
              isAI: true,
            });
          }
        }
      }

      if (terrainEffect.extraTurn) {
        gs.extraTurn = true;
        await this.saveGameState(gs);
        this.broadcast({ type: 'extraTurn', playerIndex: currentPlayer.index });
        await this.processAITurn(gs);
        return;
      }
    }

    await this.advanceTurn(gs);
  }

  // ==================== 辅助方法 ====================

  async getGameState() {
    return await this.storage.get('gameState');
  }

  async saveGameState(gs) {
    await this.storage.put('gameState', gs);
  }

  sanitizeState(gs) {
    return {
      id: gs.id,
      mode: gs.mode,
      status: gs.status,
      turn: gs.turn,
      currentPlayer: gs.currentPlayer,
      playerCount: gs.playerCount,
      players: gs.players.map(p => ({
        id: p.id,
        name: p.name,
        index: p.index,
        color: p.color,
        isAI: p.isAI,
        aiLevel: p.aiLevel,
        ready: p.ready,
        connected: p.connected,
        alive: p.alive,
      })),
      pieces: gs.pieces,
      board: gs.board,
      scores: gs.scores,
      config: gs.config,
      events: gs.events?.slice(-5) || [],
      extraTurn: gs.extraTurn,
    };
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try { ws.send(msg); } catch (e) { /* ignore closed sockets */ }
    }
  }

  sendTo(playerId, data) {
    const sockets = this.ctx.getWebSockets(playerId);
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
      try { ws.send(msg); } catch (e) { /* ignore */ }
    }
  }

  async saveGameResult(gs, ranking) {
    try {
      const db = this.env.DB;
      if (!db) return;

      await db.prepare(
        `INSERT OR REPLACE INTO games (id, mode, status, player_count, winner_id, config, finished_at, duration_seconds)
         VALUES (?, ?, 'finished', ?, ?, ?, datetime('now'), ?)`
      ).bind(
        gs.id, gs.mode, gs.playerCount,
        gs.winner >= 0 ? gs.players.find(p => p.index === gs.winner)?.id : null,
        JSON.stringify(gs.config),
        Math.floor((Date.now() - gs.createdAt) / 1000)
      ).run();

      for (const player of gs.players) {
        if (player.isAI) continue;
        const result = player.index === gs.winner ? 'win' : 'lose';
        await db.prepare(
          `INSERT OR REPLACE INTO game_players (game_id, player_id, player_index, is_ai, score, result)
           VALUES (?, ?, ?, 0, ?, ?)`
        ).bind(gs.id, player.id, player.index, gs.scores[player.index] || 0, result).run();

        // 更新玩家统计
        const ratingChange = result === 'win' ? 25 : -15;
        await db.prepare(
          `UPDATE players SET games_played = games_played + 1,
           games_won = games_won + CASE WHEN ? = 'win' THEN 1 ELSE 0 END,
           rating = MAX(0, rating + ?),
           last_seen = datetime('now')
           WHERE id = ?`
        ).bind(result, ratingChange, player.id).run();
      }
    } catch (e) {
      console.error('Failed to save game result:', e);
    }
  }
}
