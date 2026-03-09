/**
 * ai.js - AI 对手逻辑
 * 三个难度级别: easy, medium, hard
 */

import { getValidMoves } from './rules.js';
import { cellKey, hexDistance, getTargetZone, getZoneCells } from './board.js';

/**
 * AI 选择最佳移动
 * @param {Object} board
 * @param {Array} pieces
 * @param {number} playerIndex
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @param {string} gameMode
 * @param {Object} config
 * @returns {{ pieceId, move }} 或 null
 */
export function getAIMove(board, pieces, playerIndex, difficulty, gameMode, config) {
  const myPieces = pieces.filter(p => p.player === playerIndex && p.active);
  if (myPieces.length === 0) return null;

  // 收集所有可能的移动
  const allMoves = [];
  for (const piece of myPieces) {
    const moves = getValidMoves(board, pieces, piece.id, config);
    for (const move of moves) {
      allMoves.push({ pieceId: piece.id, piece, move });
    }
  }

  if (allMoves.length === 0) return null;

  switch (difficulty) {
    case 'easy':
      return easyAI(allMoves);
    case 'medium':
      return mediumAI(allMoves, board, pieces, playerIndex, gameMode);
    case 'hard':
      return hardAI(allMoves, board, pieces, playerIndex, gameMode, config);
    default:
      return mediumAI(allMoves, board, pieces, playerIndex, gameMode);
  }
}

/**
 * 简单AI：随机选择
 */
function easyAI(allMoves) {
  const idx = Math.floor(Math.random() * allMoves.length);
  return allMoves[idx];
}

/**
 * 中等AI：贪心策略
 */
function mediumAI(allMoves, board, pieces, playerIndex, gameMode) {
  const scored = allMoves.map(m => ({
    ...m,
    score: evaluateMove(m, board, pieces, playerIndex, gameMode),
  }));

  scored.sort((a, b) => b.score - a.score);

  // 从前3个最优中随机选一个（增加不确定性）
  const topN = Math.min(3, scored.length);
  const idx = Math.floor(Math.random() * topN);
  return scored[idx];
}

/**
 * 困难AI：深度评估 + Minimax 风格
 */
function hardAI(allMoves, board, pieces, playerIndex, gameMode, config) {
  const scored = allMoves.map(m => ({
    ...m,
    score: evaluateMoveDeep(m, board, pieces, playerIndex, gameMode, config),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]; // 选最优
}

/**
 * 评估单次移动的分数
 */
function evaluateMove(moveData, board, pieces, playerIndex, gameMode) {
  const { piece, move } = moveData;
  let score = 0;
  const toCoords = board[move.to];

  switch (gameMode) {
    case 'classic':
      score += evaluateClassicMove(piece, move, board, playerIndex);
      break;
    case 'points':
      score += evaluatePointsMove(piece, move, board, pieces, playerIndex);
      break;
    case 'survival':
      score += evaluateSurvivalMove(piece, move, board, pieces, playerIndex);
      break;
  }

  // 跳跃加分（更远更好）
  if (move.type === 'hop' && move.path) {
    score += (move.path.length - 1) * 2;
  }

  // 特殊地形加分
  if (toCoords) {
    if (toCoords.terrain === 'speed') score += 3;
    if (toCoords.terrain === 'teleporter') score += 1;
    if (toCoords.terrain === 'ice') score -= 1; // 冰面有风险
    if (toCoords.terrain === 'collapse') score -= 5; // 塌陷区危险
  }

  return score;
}

/**
 * 经典模式移动评估
 */
function evaluateClassicMove(piece, move, board, playerIndex) {
  const targetZone = getTargetZone(playerIndex);
  const toCell = board[move.to];

  // 计算前后到目标区域中心的距离变化
  const targetCenter = getTargetCenter(playerIndex);
  const distBefore = hexDistance(piece.q, piece.r, targetCenter.q, targetCenter.r);
  const distAfter = hexDistance(move.toQ, move.toR, targetCenter.q, targetCenter.r);
  let score = (distBefore - distAfter) * 10;

  // 已经在目标区域的棋子不动加分
  if (toCell && toCell.zone === targetZone) {
    score += 15;
  }

  // 避免留在母区不动（除非那就是目标区）
  const fromCell = board[cellKey(piece.q, piece.r)];
  if (fromCell && fromCell.zone === `home_${playerIndex}`) {
    score += 5; // 鼓励离开母区
  }

  return score;
}

/**
 * 积分模式移动评估
 */
function evaluatePointsMove(piece, move, board, pieces, playerIndex) {
  const toCell = board[move.to];
  let score = 0;

  // 高价值资源格加分
  if (toCell && toCell.resourceValue > 0) {
    score += toCell.resourceValue * 10;
  }

  // 如果当前在资源格上，不移动的代价
  const fromKey = cellKey(piece.q, piece.r);
  const fromCell = board[fromKey];
  if (fromCell && fromCell.resourceValue > 0) {
    score -= fromCell.resourceValue * 5; // 离开资源格有代价
  }

  // 靠近其他资源格
  for (const [key, cell] of Object.entries(board)) {
    if (cell.resourceValue > 0) {
      const coords = cell;
      const dist = hexDistance(move.toQ, move.toR, coords.q, coords.r);
      score += cell.resourceValue / (dist + 1) * 2;
    }
  }

  return score;
}

/**
 * 生存模式移动评估
 */
function evaluateSurvivalMove(piece, move, board, pieces, playerIndex) {
  let score = 0;

  // 跳过敌方棋子造成伤害
  if (move.hoppedOver) {
    for (const hopKey of move.hoppedOver) {
      const cell = board[hopKey];
      if (cell && cell.piece) {
        const target = pieces.find(p => p.id === cell.piece);
        if (target && target.player !== playerIndex) {
          score += 15; // 攻击敌方
          if (target.hp <= (piece.type === 'assassin' ? 2 : 1)) {
            score += 20; // 可以消灭敌方
          }
        }
      }
    }
  }

  // 刺客更倾向攻击
  if (piece.type === 'assassin' && move.type === 'assassin_leap') {
    score += 10;
  }

  // 低HP棋子应该远离威胁
  if (piece.hp === 1) {
    const threats = countThreats(board, pieces, move.toQ, move.toR, playerIndex);
    score -= threats * 8;
  }

  // 盾牌倾向于保护队友
  if (piece.type === 'shield') {
    const nearAllies = countNearAllies(board, pieces, move.toQ, move.toR, playerIndex);
    score += nearAllies * 5;
  }

  return score;
}

/**
 * 深度评估（困难AI专用）
 */
function evaluateMoveDeep(moveData, board, pieces, playerIndex, gameMode, config) {
  let score = evaluateMove(moveData, board, pieces, playerIndex, gameMode);

  // 模拟执行移动后的局面
  const { piece, move } = moveData;
  const fromKey = cellKey(piece.q, piece.r);

  // 位置优势：靠近中心但不太靠近
  const distFromCenter = hexDistance(move.toQ, move.toR, 0, 0);
  if (distFromCenter <= 4) {
    score += 2; // 中心位置更灵活
  }

  // 机动性评估：目标位置邻居空格多=机动性好
  const mobility = countEmptyNeighbors(board, move.toQ, move.toR);
  score += mobility;

  // 避免被包围
  if (mobility === 0 && move.type !== 'hop') {
    score -= 10;
  }

  return score;
}

/**
 * 获取目标区域中心坐标
 */
function getTargetCenter(playerIndex) {
  const centers = [
    { q: 2, r: -6 }, // target for player 0 → home_3 area
    { q: 6, r: -2 }, // target for player 1 → home_4
    { q: 2, r: 4 },  // target for player 2 → home_5
    { q: -2, r: 6 }, // target for player 3 → home_0
    { q: -6, r: 2 }, // target for player 4 → home_1
    { q: -2, r: -4 },// target for player 5 → home_2
  ];
  return centers[playerIndex] || { q: 0, r: 0 };
}

function countThreats(board, pieces, q, r, myPlayer) {
  let threats = 0;
  // 简化：计算2步范围内的敌方棋子
  for (const piece of pieces) {
    if (piece.player === myPlayer || !piece.active) continue;
    if (hexDistance(q, r, piece.q, piece.r) <= 2) threats++;
  }
  return threats;
}

function countNearAllies(board, pieces, q, r, myPlayer) {
  let allies = 0;
  for (const piece of pieces) {
    if (piece.player !== myPlayer || !piece.active) continue;
    if (hexDistance(q, r, piece.q, piece.r) <= 2) allies++;
  }
  return allies;
}

function countEmptyNeighbors(board, q, r) {
  const dirs = [
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
  ];
  let count = 0;
  for (const d of dirs) {
    const nk = cellKey(q + d.q, r + d.r);
    if (board[nk] && !board[nk].piece && board[nk].terrain !== 'obstacle') count++;
  }
  return count;
}

/**
 * AI 法师能力使用决策
 */
export function getAIMageAction(board, pieces, piece, playerIndex, gameMode) {
  if (piece.type !== 'mage' || piece.cooldown > 0) return null;

  const dirs = [
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
  ];

  // 尝试在敌方路径上放障碍
  for (const d of dirs) {
    const targetKey = cellKey(piece.q + d.q, piece.r + d.r);
    const cell = board[targetKey];
    if (!cell || cell.zone !== 'center' || cell.piece) continue;

    if (cell.terrain === 'normal') {
      // 检查附近是否有敌方棋子可能经过
      const nearEnemy = pieces.some(p =>
        p.player !== playerIndex && p.active &&
        hexDistance(p.q, p.r, piece.q + d.q, piece.r + d.r) <= 3
      );
      if (nearEnemy && Math.random() > 0.5) {
        return { targetKey, terrain: 'obstacle' };
      }
    }
  }

  return null;
}
