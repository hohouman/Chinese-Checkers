/**
 * terrain.js - 动态地形系统
 * 地形类型：normal, teleporter, obstacle, speed, ice, collapse
 */

export const TERRAIN_TYPES = {
  normal: {
    name: '普通',
    color: '#f5e6ca',
    passable: true,
    description: '标准地形',
  },
  teleporter: {
    name: '传送阵',
    color: '#9b59b6',
    passable: true,
    description: '踏入后传送到关联的传送阵',
    glow: true,
  },
  obstacle: {
    name: '障碍物',
    color: '#5d6d7e',
    passable: false,
    description: '不可通行的障碍',
  },
  speed: {
    name: '加速带',
    color: '#f1c40f',
    passable: true,
    description: '踏入后获得额外一次移动机会',
  },
  ice: {
    name: '冰面',
    color: '#85c1e9',
    passable: true,
    description: '棋子沿移动方向滑行至下一格',
  },
  collapse: {
    name: '塌陷区',
    color: '#e67e22',
    passable: true,
    description: '特定回合后塌陷为障碍物',
    warning: true,
  },
};

/**
 * 在棋盘中央区域随机放置地形要素
 * @param {Object} board
 * @param {Object} options { teleporterPairs, obstacles, speedZones, icePatches, collapseZones }
 */
export function generateRandomTerrain(board, options = {}) {
  const {
    teleporterPairs = 2,
    obstacles = 4,
    speedZones = 3,
    icePatches = 2,
    collapseZones = 2,
    maxTurn = 20,
  } = options;

  // 只在中心区域放置地形
  const centerCells = Object.keys(board).filter(
    k => board[k].zone === 'center' && !board[k].piece
  );

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const available = shuffle(centerCells);
  let idx = 0;

  const take = () => {
    if (idx >= available.length) return null;
    return available[idx++];
  };

  // 传送阵 (成对出现)
  for (let i = 0; i < teleporterPairs; i++) {
    const a = take(), b = take();
    if (!a || !b) break;
    board[a].terrain = 'teleporter';
    board[a].terrainData = { linkedTo: b };
    board[b].terrain = 'teleporter';
    board[b].terrainData = { linkedTo: a };
  }

  // 障碍物
  for (let i = 0; i < obstacles; i++) {
    const k = take();
    if (!k) break;
    board[k].terrain = 'obstacle';
    board[k].terrainData = null;
  }

  // 加速带
  for (let i = 0; i < speedZones; i++) {
    const k = take();
    if (!k) break;
    board[k].terrain = 'speed';
    board[k].terrainData = null;
  }

  // 冰面
  for (let i = 0; i < icePatches; i++) {
    const k = take();
    if (!k) break;
    board[k].terrain = 'ice';
    board[k].terrainData = null;
  }

  // 塌陷区
  for (let i = 0; i < collapseZones; i++) {
    const k = take();
    if (!k) break;
    const collapseTurn = 5 + Math.floor(Math.random() * (maxTurn - 5));
    board[k].terrain = 'collapse';
    board[k].terrainData = { collapseAtTurn: collapseTurn };
  }
}

/**
 * 处理地形效果
 * @returns {{ extraTurn, teleported, slid }} 效果结果
 */
export function applyTerrainEffect(board, pieceKey, moveDirection) {
  const cell = board[pieceKey];
  if (!cell) return {};

  const result = {};

  switch (cell.terrain) {
    case 'teleporter': {
      if (cell.terrainData?.linkedTo && board[cell.terrainData.linkedTo]) {
        const target = board[cell.terrainData.linkedTo];
        if (!target.piece) {
          result.teleported = true;
          result.teleportTo = cell.terrainData.linkedTo;
        }
      }
      break;
    }
    case 'speed': {
      result.extraTurn = true;
      break;
    }
    case 'ice': {
      if (moveDirection) {
        const { q, r } = board[pieceKey];
        const nextQ = q + moveDirection.q;
        const nextR = r + moveDirection.r;
        const nextKey = `${nextQ},${nextR}`;
        if (board[nextKey] && !board[nextKey].piece && board[nextKey].terrain !== 'obstacle') {
          result.slid = true;
          result.slideTo = nextKey;
        }
      }
      break;
    }
  }

  return result;
}

/**
 * 检查塌陷区事件（每回合调用）
 * @returns {Array} 塌陷的格子列表
 */
export function checkCollapseEvents(board, currentTurn) {
  const collapsed = [];
  for (const [key, cell] of Object.entries(board)) {
    if (cell.terrain === 'collapse' && cell.terrainData?.collapseAtTurn === currentTurn) {
      // 如果有棋子在上面，先弹出
      cell.terrain = 'obstacle';
      cell.terrainData = null;
      collapsed.push({ key, hadPiece: cell.piece });
    }
  }
  return collapsed;
}

/**
 * 法师能力：改变地形
 */
export function mageTerraform(board, targetKey, newTerrain) {
  const cell = board[targetKey];
  if (!cell) return false;
  if (cell.zone !== 'center') return false; // 只能改变中心区域

  if (cell.terrain === 'normal') {
    cell.terrain = newTerrain;
    cell.terrainData = newTerrain === 'teleporter' ? null : null;
    return true;
  } else if (cell.terrain !== 'obstacle') {
    cell.terrain = 'normal';
    cell.terrainData = null;
    return true;
  }
  return false;
}
