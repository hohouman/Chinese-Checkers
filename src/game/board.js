/**
 * board.js - 六角星棋盘生成与坐标系统
 * 使用立方坐标 (q, r, s)，其中 q + r + s = 0
 * 标准跳棋星形棋盘：中心六边形(半径4) + 6个三角臂(各10格) = 121格
 */

export const BOARD_RADIUS = 4;

// 六方向偏移量
export const HEX_DIRS = [
  { q: 1, r: -1, s: 0 },
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
];

// 玩家颜色配置
export const PLAYER_COLORS = [
  { name: '红方', color: '#e74c3c', light: '#fadbd8', dark: '#922b21' },
  { name: '蓝方', color: '#3498db', light: '#d4e6f1', dark: '#1a5276' },
  { name: '绿方', color: '#27ae60', light: '#d5f5e3', dark: '#1e8449' },
  { name: '紫方', color: '#8e44ad', light: '#e8daef', dark: '#6c3483' },
  { name: '橙方', color: '#e67e22', light: '#fdebd0', dark: '#af601a' },
  { name: '青方', color: '#16a085', light: '#d1f2eb', dark: '#0e6655' },
];

// 不同人数对应的玩家位置
export const PLAYER_POSITIONS = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

export function cellKey(q, r) {
  return `${q},${r}`;
}

export function parseKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r, s: -q - r };
}

/**
 * 判断坐标属于哪个区域
 * 规则：星形 = 至少两个绝对值 ≤ BOARD_RADIUS
 */
function getZone(q, r, s) {
  const aq = Math.abs(q), ar = Math.abs(r), as = Math.abs(s);
  const within = (aq <= BOARD_RADIUS) + (ar <= BOARD_RADIUS) + (as <= BOARD_RADIUS);
  if (within < 2) return null; // 不在棋盘内
  if (within === 3) return 'center';

  // 六个三角臂
  if (s > BOARD_RADIUS) return 'home_0';
  if (q < -BOARD_RADIUS) return 'home_1';
  if (r > BOARD_RADIUS) return 'home_2';
  if (s < -BOARD_RADIUS) return 'home_3';
  if (q > BOARD_RADIUS) return 'home_4';
  if (r < -BOARD_RADIUS) return 'home_5';

  return 'center';
}

/**
 * 生成完整星形棋盘
 * @returns {Object} 棋盘对象 { "q,r": cellData }
 */
export function generateStarBoard() {
  const board = {};
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      const s = -q - r;
      if (Math.abs(s) > 8) continue;
      const zone = getZone(q, r, s);
      if (!zone) continue;
      board[cellKey(q, r)] = {
        q, r, s,
        terrain: 'normal',
        terrainData: null,
        zone,
        piece: null,
        resourceValue: 0,
      };
    }
  }
  return board;
}

/**
 * 获取某个玩家的母区 (Home zone)
 */
export function getHomeZone(playerIndex) {
  return `home_${playerIndex}`;
}

/**
 * 获取某个玩家的目标区 (对面的臂)
 */
export function getTargetZone(playerIndex) {
  return `home_${(playerIndex + 3) % 6}`;
}

/**
 * 获取某区域所有格子的 key 列表
 */
export function getZoneCells(board, zone) {
  return Object.keys(board).filter(k => board[k].zone === zone);
}

/**
 * 获取相邻格子坐标
 */
export function getNeighborCoords(q, r) {
  return HEX_DIRS.map(d => ({
    q: q + d.q,
    r: r + d.r,
    s: -(q + d.q) - (r + d.r),
  }));
}

/**
 * 获取相邻格子 (仅存在于棋盘上的)
 */
export function getNeighbors(board, q, r) {
  return getNeighborCoords(q, r)
    .map(c => ({ ...c, key: cellKey(c.q, c.r) }))
    .filter(c => board[c.key]);
}

/**
 * 两点之间的六角距离
 */
export function hexDistance(q1, r1, q2, r2) {
  const s1 = -q1 - r1, s2 = -q2 - r2;
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2));
}

/**
 * 立方坐标 → 像素坐标 (pointy-top hex)
 */
export function cubeToPixel(q, r, size) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

/**
 * 像素坐标 → 立方坐标 (带四舍五入)
 */
export function pixelToCube(px, py, size) {
  const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / size;
  const r = (2 / 3 * py) / size;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr, s: rs };
}

/**
 * 计算从目标区中心到某点的距离 (用于评估进度)
 */
export function distanceToTarget(q, r, playerIndex) {
  // 每个母区(home zone)的中心坐标（由实际棋盘格子计算得出）
  const zoneCenters = [
    { q: -3, r: -3 },  // home_0 中心
    { q: -6, r: 3 },   // home_1 中心
    { q: -3, r: 6 },   // home_2 中心
    { q: 3, r: 3 },    // home_3 中心
    { q: 6, r: -3 },   // home_4 中心
    { q: 3, r: -6 },   // home_5 中心
  ];
  // 目标区 = 对面的边
  const targetIdx = (playerIndex + 3) % 6;
  const tc = zoneCenters[targetIdx];
  return hexDistance(q, r, tc.q, tc.r);
}

/**
 * 获取所有格子坐标（用于遍历）
 */
export function getAllCellKeys(board) {
  return Object.keys(board);
}
