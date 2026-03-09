/**
 * modes.js - 游戏模式与胜利条件
 */

import { getTargetZone, getZoneCells, cellKey } from './board.js';

export const GAME_MODES = {
  classic: {
    name: '经典模式',
    description: '将所有棋子移动到对面目标区域即可获胜',
    icon: '🏁',
    minPlayers: 2,
    maxPlayers: 6,
    defaultConfig: {
      enableAbilities: true,
      enableTerrain: true,
      enableEvents: true,
      eventFrequency: 6,
      turnTimeLimit: 60,
    },
  },
  points: {
    name: '积分模式',
    description: '占领高价值资源地块获取积分，率先达到目标分数获胜',
    icon: '💎',
    minPlayers: 2,
    maxPlayers: 6,
    defaultConfig: {
      enableAbilities: true,
      enableTerrain: true,
      enableEvents: true,
      eventFrequency: 5,
      turnTimeLimit: 45,
      targetScore: 50,
      resourceCellCount: 8,
    },
  },
  survival: {
    name: '生存模式',
    description: '击败敌方棋子，最后存活的玩家获胜',
    icon: '⚔️',
    minPlayers: 2,
    maxPlayers: 6,
    defaultConfig: {
      enableAbilities: true,
      enableTerrain: true,
      enableEvents: true,
      eventFrequency: 4,
      turnTimeLimit: 45,
      eliminationThreshold: 0, // 剩余棋子为0时淘汰
    },
  },
};

/**
 * 为积分模式设置资源点
 */
export function setupResourceCells(board, count = 8) {
  const centerCells = Object.keys(board).filter(
    k => board[k].zone === 'center' && board[k].terrain === 'normal'
  );

  const shuffled = centerCells.sort(() => Math.random() - 0.5);
  const resourceCells = [];

  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const value = Math.random() > 0.7 ? 3 : (Math.random() > 0.5 ? 2 : 1);
    board[shuffled[i]].resourceValue = value;
    resourceCells.push({ key: shuffled[i], value });
  }

  return resourceCells;
}

/**
 * 计算积分模式每回合得分
 */
export function calculateTurnScores(board, pieces, players) {
  const scores = {};
  for (const p of players) {
    scores[p.index] = 0;
  }

  for (const [key, cell] of Object.entries(board)) {
    if (cell.resourceValue > 0 && cell.piece) {
      const piece = pieces.find(p => p.id === cell.piece);
      if (piece && piece.active) {
        scores[piece.player] = (scores[piece.player] || 0) + cell.resourceValue;
      }
    }
  }

  return scores;
}

/**
 * 检查经典模式胜利条件
 * 玩家的所有活跃棋子都在目标区域内
 */
export function checkClassicVictory(board, pieces, playerIndex) {
  const targetZone = getTargetZone(playerIndex);
  const playerPieces = pieces.filter(p => p.player === playerIndex && p.active);

  if (playerPieces.length === 0) return false;

  return playerPieces.every(p => {
    const key = cellKey(p.q, p.r);
    return board[key] && board[key].zone === targetZone;
  });
}

/**
 * 检查积分模式胜利条件
 */
export function checkPointsVictory(playerScores, targetScore) {
  for (const [idx, score] of Object.entries(playerScores)) {
    if (score >= targetScore) return parseInt(idx);
  }
  return -1;
}

/**
 * 检查生存模式胜利条件
 * 只剩一个玩家有活跃棋子
 */
export function checkSurvivalVictory(pieces, players) {
  const alivePlayers = [];

  for (const player of players) {
    const alive = pieces.filter(p => p.player === player.index && p.active);
    if (alive.length > 0) {
      alivePlayers.push(player.index);
    }
  }

  if (alivePlayers.length === 1) return alivePlayers[0];
  if (alivePlayers.length === 0) return -2; // 平局
  return -1; // 游戏继续
}

/**
 * 综合胜利检查
 */
export function checkVictory(gameState) {
  const { mode, board, pieces, players, scores, config } = gameState;

  switch (mode) {
    case 'classic': {
      for (const player of players) {
        if (!player.alive) continue;
        if (checkClassicVictory(board, pieces, player.index)) {
          return { winner: player.index, reason: 'classic_complete' };
        }
      }
      return null;
    }

    case 'points': {
      const winnerIdx = checkPointsVictory(scores, config.targetScore || 50);
      if (winnerIdx >= 0) {
        return { winner: winnerIdx, reason: 'points_target_reached' };
      }
      return null;
    }

    case 'survival': {
      const winnerIdx = checkSurvivalVictory(pieces, players);
      if (winnerIdx === -2) return { winner: -1, reason: 'draw' };
      if (winnerIdx >= 0) return { winner: winnerIdx, reason: 'last_standing' };
      return null;
    }

    default:
      return null;
  }
}

/**
 * 获取游戏结束时的排名
 */
export function getGameRanking(gameState) {
  const { mode, players, pieces, scores } = gameState;
  const ranking = players.map(p => ({
    index: p.index,
    name: p.name,
    isAI: p.isAI,
    score: scores?.[p.index] || 0,
    piecesAlive: pieces.filter(pc => pc.player === p.index && pc.active).length,
  }));

  switch (mode) {
    case 'classic':
      // 按照到达目标区域的棋子数排序
      ranking.sort((a, b) => b.piecesAlive - a.piecesAlive);
      break;
    case 'points':
      ranking.sort((a, b) => b.score - a.score);
      break;
    case 'survival':
      ranking.sort((a, b) => b.piecesAlive - a.piecesAlive);
      break;
  }

  return ranking;
}
