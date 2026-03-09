/**
 * pieces.js - 棋子类型与能力系统
 */

// 棋子类型定义
export const PIECE_TYPES = {
  pawn: {
    name: '兵',
    icon: '●',
    hp: 2,
    description: '基础棋子，标准移动和跳跃规则',
    abilityName: null,
    abilityDesc: null,
  },
  assassin: {
    name: '刺客',
    icon: '◆',
    hp: 1,
    description: '可跨越两格障碍，生存模式攻击力×2',
    abilityName: '暗杀突袭',
    abilityDesc: '可跳过两个相邻棋子降落到第三格',
    abilityCooldown: 0,
  },
  shield: {
    name: '盾牌',
    icon: '■',
    hp: 4,
    description: '敌方无法跳过此棋子',
    abilityName: '坚壁',
    abilityDesc: '敌方棋子无法跳过此棋子',
    abilityCooldown: 0,
  },
  mage: {
    name: '法师',
    icon: '★',
    hp: 2,
    description: '移动后可改变相邻地砖属性',
    abilityName: '地形塑造',
    abilityDesc: '移动后可将一个相邻普通地砖变为特殊地形（或反转）',
    abilityCooldown: 3,
  },
  scout: {
    name: '斥候',
    icon: '▲',
    hp: 1,
    description: '可连续步行两格（不需跳跃）',
    abilityName: '疾行',
    abilityDesc: '一回合内可步行两格',
    abilityCooldown: 0,
  },
};

// 每位玩家的初始棋子配置
export const DEFAULT_PIECE_LOADOUT = [
  { type: 'pawn' },
  { type: 'pawn' },
  { type: 'pawn' },
  { type: 'pawn' },
  { type: 'pawn' },
  { type: 'pawn' },
  { type: 'assassin' },
  { type: 'shield' },
  { type: 'mage' },
  { type: 'scout' },
];

let _pieceIdCounter = 0;

export function resetPieceIdCounter() {
  _pieceIdCounter = 0;
}

/**
 * 创建一个棋子对象
 */
export function createPiece(type, playerIndex) {
  const def = PIECE_TYPES[type];
  return {
    id: `p${playerIndex}_${_pieceIdCounter++}`,
    type,
    player: playerIndex,
    hp: def.hp,
    maxHp: def.hp,
    active: true,
    cooldown: 0, // 能力冷却回合数
  };
}

/**
 * 在棋盘上为玩家放置初始棋子
 * @param {Object} board - 棋盘对象
 * @param {number} playerIndex - 玩家索引
 * @param {string} homeZone - 玩家母区标识
 * @param {Array} loadout - 棋子配置列表
 * @returns {Array} 创建的棋子列表
 */
export function placeInitialPieces(board, playerIndex, homeZone, loadout = DEFAULT_PIECE_LOADOUT) {
  const homeCells = Object.keys(board)
    .filter(k => board[k].zone === homeZone)
    .sort(); // 确保顺序一致

  const pieces = [];
  const count = Math.min(loadout.length, homeCells.length);

  for (let i = 0; i < count; i++) {
    const piece = createPiece(loadout[i].type, playerIndex);
    const key = homeCells[i];
    board[key].piece = piece.id;
    piece.q = board[key].q;
    piece.r = board[key].r;
    pieces.push(piece);
  }

  return pieces;
}

/**
 * 获取棋子类型信息
 */
export function getPieceType(type) {
  return PIECE_TYPES[type] || PIECE_TYPES.pawn;
}

/**
 * 判断棋子是否有主动能力
 */
export function hasActiveAbility(piece) {
  const def = PIECE_TYPES[piece.type];
  return def.abilityName && (piece.type === 'mage');
}

/**
 * 判断棋子能力是否可用（冷却完毕）
 */
export function isAbilityReady(piece) {
  return hasActiveAbility(piece) && piece.cooldown <= 0;
}

/**
 * 每回合减少冷却
 */
export function tickCooldowns(pieces) {
  for (const p of pieces) {
    if (p.cooldown > 0) p.cooldown--;
  }
}
