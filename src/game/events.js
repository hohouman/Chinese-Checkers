/**
 * events.js - 随机事件系统
 * 每隔若干回合触发随机事件，增加游戏变数
 */

import { cellKey, getNeighborCoords } from './board.js';

export const EVENT_TYPES = {
  collapse: {
    name: '区域塌陷',
    description: '一块区域变为不可通行',
    icon: '💥',
  },
  blessing: {
    name: '地脉祝福',
    description: '一块区域变为加速带',
    icon: '✨',
  },
  portal: {
    name: '次元裂隙',
    description: '随机出现一对传送阵',
    icon: '🌀',
  },
  freeze: {
    name: '寒冰风暴',
    description: '一块区域变为冰面',
    icon: '❄️',
  },
  heal: {
    name: '生命之泉',
    description: '所有棋子恢复1点HP（生存模式）',
    icon: '💚',
  },
  quake: {
    name: '地震',
    description: '随机清除部分障碍物',
    icon: '🌋',
  },
};

/**
 * 判断当前回合是否应触发事件
 */
export function shouldTriggerEvent(turnNumber, config = {}) {
  const { eventFrequency = 5, enableEvents = true } = config;
  if (!enableEvents) return false;
  if (turnNumber < 3) return false; // 前3回合不触发
  return turnNumber % eventFrequency === 0;
}

/**
 * 生成随机事件
 */
export function generateRandomEvent(board, turnNumber, gameMode) {
  const eventKeys = Object.keys(EVENT_TYPES);
  // 生存模式可以触发heal，其余模式不触发
  const filtered = gameMode === 'survival'
    ? eventKeys
    : eventKeys.filter(k => k !== 'heal');

  const type = filtered[Math.floor(Math.random() * filtered.length)];
  const event = { type, turn: turnNumber, ...EVENT_TYPES[type] };

  // 选择受影响的格子
  const centerCells = Object.keys(board).filter(
    k => board[k].zone === 'center' && board[k].terrain === 'normal' && !board[k].piece
  );

  if (centerCells.length === 0) return null;

  switch (type) {
    case 'collapse': {
      const target = centerCells[Math.floor(Math.random() * centerCells.length)];
      event.affectedCells = [target];
      break;
    }
    case 'blessing': {
      const target = centerCells[Math.floor(Math.random() * centerCells.length)];
      event.affectedCells = [target];
      break;
    }
    case 'portal': {
      if (centerCells.length < 2) return null;
      const shuffled = centerCells.sort(() => Math.random() - 0.5);
      event.affectedCells = [shuffled[0], shuffled[1]];
      break;
    }
    case 'freeze': {
      const target = centerCells[Math.floor(Math.random() * centerCells.length)];
      // 冻结目标及相邻格
      const affected = [target];
      const coords = board[target];
      const neighbors = getNeighborCoords(coords.q, coords.r);
      for (const n of neighbors) {
        const nk = cellKey(n.q, n.r);
        if (board[nk] && board[nk].zone === 'center' && !board[nk].piece && board[nk].terrain === 'normal') {
          affected.push(nk);
          if (affected.length >= 3) break;
        }
      }
      event.affectedCells = affected;
      break;
    }
    case 'heal': {
      event.affectedCells = [];
      break;
    }
    case 'quake': {
      const obstacles = Object.keys(board).filter(k => board[k].terrain === 'obstacle' && board[k].zone === 'center');
      const toRemove = obstacles.slice(0, Math.min(2, obstacles.length));
      event.affectedCells = toRemove;
      break;
    }
  }

  return event;
}

/**
 * 执行事件效果
 */
export function executeEvent(board, pieces, event) {
  if (!event) return [];

  const changes = [];

  switch (event.type) {
    case 'collapse':
      for (const key of event.affectedCells) {
        if (board[key]) {
          // 如果有棋子在上面，需要弹出到相邻空格
          if (board[key].piece) {
            const displaced = displacePiece(board, pieces, key);
            if (displaced) changes.push(displaced);
          }
          board[key].terrain = 'obstacle';
          board[key].terrainData = null;
          changes.push({ type: 'terrainChange', key, terrain: 'obstacle' });
        }
      }
      break;

    case 'blessing':
      for (const key of event.affectedCells) {
        if (board[key]) {
          board[key].terrain = 'speed';
          changes.push({ type: 'terrainChange', key, terrain: 'speed' });
        }
      }
      break;

    case 'portal':
      if (event.affectedCells.length === 2) {
        const [a, b] = event.affectedCells;
        board[a].terrain = 'teleporter';
        board[a].terrainData = { linkedTo: b };
        board[b].terrain = 'teleporter';
        board[b].terrainData = { linkedTo: a };
        changes.push({ type: 'terrainChange', key: a, terrain: 'teleporter' });
        changes.push({ type: 'terrainChange', key: b, terrain: 'teleporter' });
      }
      break;

    case 'freeze':
      for (const key of event.affectedCells) {
        if (board[key]) {
          board[key].terrain = 'ice';
          changes.push({ type: 'terrainChange', key, terrain: 'ice' });
        }
      }
      break;

    case 'heal':
      for (const p of pieces) {
        if (p.active && p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          changes.push({ type: 'heal', pieceId: p.id, hp: p.hp });
        }
      }
      break;

    case 'quake':
      for (const key of event.affectedCells) {
        if (board[key]) {
          board[key].terrain = 'normal';
          board[key].terrainData = null;
          changes.push({ type: 'terrainChange', key, terrain: 'normal' });
        }
      }
      break;
  }

  return changes;
}

/**
 * 将棋子弹出到相邻空格
 */
function displacePiece(board, pieces, key) {
  const cell = board[key];
  if (!cell || !cell.piece) return null;

  const piece = pieces.find(p => p.id === cell.piece);
  if (!piece) return null;

  const neighbors = getNeighborCoords(cell.q, cell.r);
  for (const n of neighbors) {
    const nk = cellKey(n.q, n.r);
    if (board[nk] && !board[nk].piece && board[nk].terrain !== 'obstacle') {
      board[nk].piece = piece.id;
      cell.piece = null;
      piece.q = n.q;
      piece.r = n.r;
      return { type: 'displaced', pieceId: piece.id, from: key, to: nk };
    }
  }

  // 无处可去，棋子被消灭
  piece.active = false;
  cell.piece = null;
  return { type: 'eliminated', pieceId: piece.id, reason: 'collapse' };
}
