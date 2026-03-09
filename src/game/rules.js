/**
 * rules.js - 游戏规则引擎：移动验证、跳跃逻辑、特殊能力
 */

import { cellKey, HEX_DIRS, getNeighborCoords, getNeighbors } from './board.js';
import { PIECE_TYPES } from './pieces.js';

/**
 * 获取棋子对象 by ID
 */
function findPiece(pieces, pieceId) {
  return pieces.find(p => p.id === pieceId);
}

/**
 * 获取某格上的棋子
 */
function pieceAt(board, pieces, q, r) {
  const cell = board[cellKey(q, r)];
  if (!cell || !cell.piece) return null;
  return pieces.find(p => p.id === cell.piece);
}

/**
 * 获取所有合法移动（包括步行、跳跃、特殊能力）
 * @param {Object} board   - 棋盘
 * @param {Array} pieces   - 所有棋子
 * @param {string} pieceId - 当前棋子ID
 * @param {Object} config  - 游戏配置
 * @returns {Array<{to: string, path: Array, type: string}>} 合法移动列表
 */
export function getValidMoves(board, pieces, pieceId, config = {}) {
  const piece = findPiece(pieces, pieceId);
  if (!piece || !piece.active) return [];

  const fromKey = cellKey(piece.q, piece.r);
  const moves = [];
  const visited = new Set();

  // 1. 步行移动（移到相邻空格）
  const stepMoves = getStepMoves(board, pieces, piece, config);
  moves.push(...stepMoves);

  // 2. 跳跃移动（连续跳跃）
  const hopMoves = getHopMoves(board, pieces, piece, config);
  moves.push(...hopMoves);

  // 3. 刺客特殊跳跃
  if (piece.type === 'assassin' && config.enableAbilities !== false) {
    const assassinMoves = getAssassinMoves(board, pieces, piece);
    moves.push(...assassinMoves);
  }

  // 4. 斥候双步
  if (piece.type === 'scout' && config.enableAbilities !== false) {
    const scoutMoves = getScoutMoves(board, pieces, piece);
    moves.push(...scoutMoves);
  }

  // 去重
  const uniqueMoves = [];
  const seen = new Set();
  for (const m of moves) {
    if (!seen.has(m.to)) {
      seen.add(m.to);
      uniqueMoves.push(m);
    }
  }

  return uniqueMoves;
}

/**
 * 步行移动
 */
function getStepMoves(board, pieces, piece, config) {
  const moves = [];
  const neighbors = getNeighborCoords(piece.q, piece.r);

  for (const n of neighbors) {
    const key = cellKey(n.q, n.r);
    const cell = board[key];
    if (!cell) continue;
    if (cell.terrain === 'obstacle') continue;
    if (cell.piece) continue;

    moves.push({
      to: key,
      toQ: n.q,
      toR: n.r,
      path: [cellKey(piece.q, piece.r), key],
      type: 'step',
      direction: { q: n.q - piece.q, r: n.r - piece.r },
    });
  }

  return moves;
}

/**
 * 跳跃移动（递归链式跳跃）
 */
function getHopMoves(board, pieces, piece, config) {
  const moves = [];
  const visited = new Set();
  visited.add(cellKey(piece.q, piece.r));

  function dfs(q, r, path) {
    for (const dir of HEX_DIRS) {
      const midQ = q + dir.q, midR = r + dir.r;
      const midKey = cellKey(midQ, midR);
      const midCell = board[midKey];

      // 中间必须有棋子
      if (!midCell || !midCell.piece) continue;
      if (midCell.terrain === 'obstacle') continue;

      // 检查盾牌能力：敌方不能跳过盾牌
      const midPiece = findPiece(pieces, midCell.piece);
      if (midPiece && midPiece.type === 'shield' && midPiece.player !== piece.player && config.enableAbilities !== false) {
        continue; // 盾牌阻挡
      }

      const landQ = q + dir.q * 2, landR = r + dir.r * 2;
      const landKey = cellKey(landQ, landR);
      const landCell = board[landKey];

      if (!landCell || landCell.piece || landCell.terrain === 'obstacle') continue;
      if (visited.has(landKey)) continue;

      visited.add(landKey);
      const newPath = [...path, landKey];

      moves.push({
        to: landKey,
        toQ: landQ,
        toR: landR,
        path: newPath,
        type: 'hop',
        direction: dir,
        hoppedOver: [...(path.length > 1 ? [] : []), midKey],
      });

      // 递归继续跳
      dfs(landQ, landR, newPath);
    }
  }

  dfs(piece.q, piece.r, [cellKey(piece.q, piece.r)]);
  return moves;
}

/**
 * 刺客特殊移动：跨越两格
 */
function getAssassinMoves(board, pieces, piece) {
  const moves = [];

  for (const dir of HEX_DIRS) {
    // 检查连续两格都有棋子
    const mid1Q = piece.q + dir.q, mid1R = piece.r + dir.r;
    const mid2Q = piece.q + dir.q * 2, mid2R = piece.r + dir.r * 2;
    const landQ = piece.q + dir.q * 3, landR = piece.r + dir.r * 3;

    const mid1Key = cellKey(mid1Q, mid1R);
    const mid2Key = cellKey(mid2Q, mid2R);
    const landKey = cellKey(landQ, landR);

    const mid1Cell = board[mid1Key];
    const mid2Cell = board[mid2Key];
    const landCell = board[landKey];

    if (!mid1Cell || !mid1Cell.piece) continue;
    if (!mid2Cell || !mid2Cell.piece) continue;
    if (!landCell || landCell.piece || landCell.terrain === 'obstacle') continue;

    moves.push({
      to: landKey,
      toQ: landQ,
      toR: landR,
      path: [cellKey(piece.q, piece.r), landKey],
      type: 'assassin_leap',
      direction: dir,
      hoppedOver: [mid1Key, mid2Key],
    });
  }

  return moves;
}

/**
 * 斥候双步移动
 */
function getScoutMoves(board, pieces, piece) {
  const moves = [];
  const start = cellKey(piece.q, piece.r);

  // 第一步
  const neighbors = getNeighborCoords(piece.q, piece.r);
  for (const n1 of neighbors) {
    const k1 = cellKey(n1.q, n1.r);
    const c1 = board[k1];
    if (!c1 || c1.piece || c1.terrain === 'obstacle') continue;

    // 第二步
    const neighbors2 = getNeighborCoords(n1.q, n1.r);
    for (const n2 of neighbors2) {
      const k2 = cellKey(n2.q, n2.r);
      if (k2 === start) continue; // 不能回到原点
      const c2 = board[k2];
      if (!c2 || c2.piece || c2.terrain === 'obstacle') continue;

      moves.push({
        to: k2,
        toQ: n2.q,
        toR: n2.r,
        path: [start, k1, k2],
        type: 'scout_dash',
        direction: { q: n2.q - n1.q, r: n2.r - n1.r },
      });
    }
  }

  return moves;
}

/**
 * 执行移动
 * @returns {{ success, effects, captured }} 移动结果
 */
export function executeMove(board, pieces, pieceId, toKey, moveData, gameMode) {
  const piece = findPiece(pieces, pieceId);
  if (!piece || !piece.active) return { success: false, error: '无效棋子' };

  const fromKey = cellKey(piece.q, piece.r);
  const toCell = board[toKey];
  if (!toCell) return { success: false, error: '无效目标' };

  const result = {
    success: true,
    effects: [],
    captured: [],
    from: fromKey,
    to: toKey,
    pieceId,
  };

  // 移动棋子
  board[fromKey].piece = null;
  toCell.piece = piece.id;
  const { q: oldQ, r: oldR } = piece;
  const newCoords = toCell;
  piece.q = newCoords.q;
  piece.r = newCoords.r;

  // 生存模式：跳过的敌方棋子受伤
  if (gameMode === 'survival' && moveData?.hoppedOver) {
    for (const hopKey of moveData.hoppedOver) {
      const hopCell = board[hopKey];
      if (!hopCell || !hopCell.piece) continue;
      const hopPiece = findPiece(pieces, hopCell.piece);
      if (!hopPiece || hopPiece.player === piece.player) continue;

      const damage = piece.type === 'assassin' ? 2 : 1;
      hopPiece.hp -= damage;
      result.effects.push({
        type: 'damage',
        target: hopPiece.id,
        damage,
        remaining: hopPiece.hp,
      });

      if (hopPiece.hp <= 0) {
        hopPiece.active = false;
        hopCell.piece = null;
        result.captured.push(hopPiece.id);
        result.effects.push({ type: 'eliminated', target: hopPiece.id });
      }
    }
  }

  return result;
}

/**
 * 法师能力：改变相邻地砖
 */
export function executeMageAbility(board, piece, targetKey, newTerrain) {
  if (piece.type !== 'mage') return { success: false, error: '非法师棋子' };
  if (piece.cooldown > 0) return { success: false, error: '能力冷却中' };

  const pieceKey = cellKey(piece.q, piece.r);
  const neighbors = getNeighborCoords(piece.q, piece.r);
  const isAdjacent = neighbors.some(n => cellKey(n.q, n.r) === targetKey);
  if (!isAdjacent) return { success: false, error: '目标不相邻' };

  const cell = board[targetKey];
  if (!cell || cell.zone !== 'center') return { success: false, error: '只能改变中心区域地形' };
  if (cell.piece) return { success: false, error: '目标格有棋子' };

  const validTerrains = ['speed', 'ice', 'obstacle'];
  if (cell.terrain === 'normal') {
    if (!validTerrains.includes(newTerrain)) return { success: false, error: '无效地形类型' };
    cell.terrain = newTerrain;
    cell.terrainData = null;
  } else {
    cell.terrain = 'normal';
    cell.terrainData = null;
  }

  piece.cooldown = PIECE_TYPES.mage.abilityCooldown;
  return { success: true, terrain: cell.terrain, key: targetKey };
}
