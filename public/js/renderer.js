/**
 * renderer.js - 六角星棋盘 Canvas 渲染器
 * 使用立方坐标 (q, r, s)，pointy-top 六边形
 */

class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hexSize = 22; // 六边形半径
    this.centerX = 0;
    this.centerY = 0;
    this.hoveredCell = null;
    this.selectedCell = null;
    this.validMoves = []; // [{to: "q,r", type}]
    this.animatingPieces = new Map(); // pieceId → animation state
    this.boardState = null;
    this.pieces = [];
    this.playerColors = [];
    this.gameMode = 'classic';

    // 传送阵配对样式（颜色+标签）
    this.teleporterPairStyles = [
      { color: '#1abc9c', fill: '#0e6655', border: '#1abc9c', label: '①' },
      { color: '#e74c3c', fill: '#78281f', border: '#e74c3c', label: '②' },
      { color: '#f39c12', fill: '#7d6608', border: '#f39c12', label: '③' },
      { color: '#3498db', fill: '#1a5276', border: '#3498db', label: '④' },
    ];
    this.teleporterPairMap = {}; // cellKey → pairIndex

    // 地形颜色
    this.terrainColors = {
      normal: '#2a2a3e',
      teleporter: '#6c3483',
      obstacle: '#4a4a5e',
      speed: '#7d6608',
      ice: '#1a5276',
      collapse: '#7e5109',
    };

    this.terrainBorder = {
      normal: '#3a3a52',
      teleporter: '#a569bd',
      obstacle: '#6a6a7e',
      speed: '#f1c40f',
      ice: '#5dade2',
      collapse: '#e67e22',
    };

    // 棋子图标
    this.pieceIcons = {
      pawn: '●',
      assassin: '◆',
      shield: '■',
      mage: '★',
      scout: '▲',
    };

    // 区域色 (淡)
    this.zoneColors = {
      home_0: 'rgba(231,76,60,0.08)',
      home_1: 'rgba(52,152,219,0.08)',
      home_2: 'rgba(39,174,96,0.08)',
      home_3: 'rgba(142,68,173,0.08)',
      home_4: 'rgba(230,126,34,0.08)',
      home_5: 'rgba(22,160,133,0.08)',
      center: 'transparent',
    };

    this.zoneBorderColors = {
      home_0: 'rgba(231,76,60,0.3)',
      home_1: 'rgba(52,152,219,0.3)',
      home_2: 'rgba(39,174,96,0.3)',
      home_3: 'rgba(142,68,173,0.3)',
      home_4: 'rgba(230,126,34,0.3)',
      home_5: 'rgba(22,160,133,0.3)',
      center: '#3a3a52',
    };

    this._resizeHandler = this.resize.bind(this);
    window.addEventListener('resize', this._resizeHandler);
    this.resize();
  }

  destroy() {
    window.removeEventListener('resize', this._resizeHandler);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.displayWidth = w;
    this.displayHeight = h;
    this.centerX = w / 2;
    this.centerY = h / 2;

    // 动态计算六边形大小以适配屏幕
    const maxBoardRadius = Math.min(w, h) / 2 - 40;
    this.hexSize = Math.max(12, Math.min(26, maxBoardRadius / 12));

    this.render();
  }

  /**
   * 更新棋盘状态
   */
  updateState(board, pieces, playerColors, gameMode) {
    this.boardState = board;
    this.pieces = pieces || [];
    this.playerColors = playerColors || [];
    this.gameMode = gameMode || 'classic';
    this.render();
  }

  /**
   * 设置高亮的合法移动
   */
  setValidMoves(moves) {
    this.validMoves = moves || [];
    this.render();
  }

  /**
   * 设置选中的格子
   */
  setSelected(cellKey) {
    this.selectedCell = cellKey;
    this.render();
  }

  /**
   * 设置悬停格子
   */
  setHovered(cellKey) {
    if (this.hoveredCell !== cellKey) {
      this.hoveredCell = cellKey;
      this.render();
    }
  }

  // ==================== 坐标转换 ====================

  cubeToPixel(q, r) {
    const x = this.hexSize * Math.sqrt(3) * (q + r / 2);
    const y = this.hexSize * 1.5 * r;
    return { x: this.centerX + x, y: this.centerY + y };
  }

  pixelToCube(px, py) {
    const x = px - this.centerX;
    const y = py - this.centerY;
    const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / this.hexSize;
    const r = (2 / 3 * y) / this.hexSize;

    let rq = Math.round(q), rr = Math.round(r);
    let rs = Math.round(-q - r);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    else rs = -rq - rr;
    return { q: rq, r: rr, s: rs };
  }

  getCellAtPixel(px, py) {
    const cube = this.pixelToCube(px, py);
    const key = `${cube.q},${cube.r}`;
    if (this.boardState && this.boardState[key]) return key;
    return null;
  }

  // ==================== 渲染 ====================

  render() {
    if (!this.boardState) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

    // 绘制背景星光效果
    this.drawBackground(ctx);

    // 构建传送阵配对映射
    this.buildTeleporterPairMap();

    // 绘制所有格子
    for (const [key, cell] of Object.entries(this.boardState)) {
      this.drawCell(ctx, key, cell);
    }

    // 绘制合法移动高亮
    for (const move of this.validMoves) {
      this.drawMoveHighlight(ctx, move);
    }

    // 绘制棋子
    for (const piece of this.pieces) {
      if (!piece.active) continue;
      this.drawPiece(ctx, piece);
    }

    // 绘制选中指示
    if (this.selectedCell && this.boardState[this.selectedCell]) {
      const cell = this.boardState[this.selectedCell];
      const pos = this.cubeToPixel(cell.q, cell.r);
      this.drawSelection(ctx, pos.x, pos.y);
    }
  }

  drawBackground(ctx) {
    // 星空背景（简单粒子）
    ctx.save();
    ctx.globalAlpha = 0.3;
    const seed = 42;
    for (let i = 0; i < 60; i++) {
      const x = ((seed * (i + 1) * 13) % this.displayWidth);
      const y = ((seed * (i + 1) * 7) % this.displayHeight);
      const r = (i % 3 === 0) ? 1.5 : 0.8;
      ctx.fillStyle = i % 5 === 0 ? '#4fc3f7' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCell(ctx, key, cell) {
    const pos = this.cubeToPixel(cell.q, cell.r);
    const size = this.hexSize;
    const isHovered = key === this.hoveredCell;
    const isSelected = key === this.selectedCell;

    ctx.save();

    // 六边形路径
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 30);
      const hx = pos.x + size * Math.cos(angle);
      const hy = pos.y + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();

    // 填充 - 地形决定基色（传送阵按配对着色）
    let fillColor = this.terrainColors[cell.terrain] || this.terrainColors.normal;
    if (cell.terrain === 'teleporter') {
      const pIdx = (this.teleporterPairMap[key] ?? 0) % this.teleporterPairStyles.length;
      fillColor = this.teleporterPairStyles[pIdx].fill;
    }

    // 区域覆盖色
    if (cell.zone !== 'center' && cell.terrain === 'normal') {
      fillColor = this.terrainColors.normal;
    }

    ctx.fillStyle = fillColor;
    ctx.fill();

    // 区域着色叠加
    if (cell.zone !== 'center') {
      ctx.fillStyle = this.zoneColors[cell.zone] || 'transparent';
      ctx.fill();
    }

    // 资源格显示
    if (cell.resourceValue > 0) {
      ctx.fillStyle = `rgba(241,196,15,${0.1 + cell.resourceValue * 0.05})`;
      ctx.fill();
    }

    // 边框
    let borderColor = this.terrainBorder[cell.terrain] || '#3a3a52';
    if (cell.terrain === 'teleporter') {
      const pIdx = (this.teleporterPairMap[key] ?? 0) % this.teleporterPairStyles.length;
      borderColor = this.teleporterPairStyles[pIdx].border;
    } else if (cell.zone !== 'center' && cell.terrain === 'normal') {
      borderColor = this.zoneBorderColors[cell.zone] || '#3a3a52';
    }
    if (isHovered) borderColor = '#ffffff';

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.stroke();

    // 特殊地形装饰
    if (cell.terrain === 'teleporter') {
      const pIdx = (this.teleporterPairMap[key] ?? 0) % this.teleporterPairStyles.length;
      this.drawTeleporterEffect(ctx, pos.x, pos.y, size, pIdx);
    } else if (cell.terrain === 'speed') {
      this.drawSpeedEffect(ctx, pos.x, pos.y, size);
    } else if (cell.terrain === 'obstacle') {
      this.drawObstacle(ctx, pos.x, pos.y, size);
    } else if (cell.terrain === 'ice') {
      this.drawIceEffect(ctx, pos.x, pos.y, size);
    } else if (cell.terrain === 'collapse') {
      this.drawCollapseEffect(ctx, pos.x, pos.y, size);
    }

    // 资源值标记
    if (cell.resourceValue > 0) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = `bold ${size * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cell.resourceValue}`, pos.x, pos.y);
    }

    ctx.restore();
  }

  buildTeleporterPairMap() {
    this.teleporterPairMap = {};
    if (!this.boardState) return;
    let pairIndex = 0;
    for (const [key, cell] of Object.entries(this.boardState)) {
      if (cell.terrain === 'teleporter' && !(key in this.teleporterPairMap)) {
        this.teleporterPairMap[key] = pairIndex;
        const linked = cell.terrainData && cell.terrainData.linkedTo;
        if (linked) {
          this.teleporterPairMap[linked] = pairIndex;
        }
        pairIndex++;
      }
    }
  }

  drawTeleporterEffect(ctx, x, y, size, pairIndex = 0) {
    const style = this.teleporterPairStyles[pairIndex % this.teleporterPairStyles.length];
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    const t = Date.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const r = size * 0.3 + i * size * 0.15 + Math.sin(t * 2 + i) * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 配对标签
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = style.color;
    ctx.font = `bold ${size * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.label, x, y);
    ctx.restore();
  }

  drawSpeedEffect(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = '#f1c40f';
    ctx.globalAlpha = 0.4;
    ctx.font = `${size * 0.6}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('»', x, y);
    ctx.restore();
  }

  drawObstacle(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = '#5d6d7e';
    ctx.globalAlpha = 0.5;
    ctx.font = `${size * 0.7}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', x, y);
    ctx.restore();
  }

  drawIceEffect(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = '#85c1e9';
    ctx.globalAlpha = 0.3;
    ctx.font = `${size * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❄', x, y);
    ctx.restore();
  }

  drawCollapseEffect(ctx, x, y, size) {
    ctx.save();
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawMoveHighlight(ctx, move) {
    const cell = this.boardState[move.to];
    if (!cell) return;
    const pos = this.cubeToPixel(cell.q, cell.r);

    ctx.save();

    // 六边形高亮
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 30);
      const hx = pos.x + this.hexSize * Math.cos(angle);
      const hy = pos.y + this.hexSize * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();

    const colors = {
      step: 'rgba(79,195,247,0.25)',
      hop: 'rgba(102,187,106,0.3)',
      assassin_leap: 'rgba(255,107,157,0.3)',
      scout_dash: 'rgba(255,167,38,0.3)',
      mage_target: 'rgba(165,105,189,0.35)',
    };

    ctx.fillStyle = colors[move.type] || 'rgba(79,195,247,0.2)';
    ctx.fill();

    ctx.strokeStyle = move.type === 'mage_target' ? 'rgba(165,105,189,0.8)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 小点指示（法师用星型）
    if (move.type === 'mage_target') {
      ctx.fillStyle = 'rgba(165,105,189,0.9)';
      ctx.font = `${this.hexSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', pos.x, pos.y);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawPiece(ctx, piece) {
    const pos = this.cubeToPixel(piece.q, piece.r);
    const size = this.hexSize;

    // 查找棋子所属玩家颜色
    const playerColor = this.playerColors[piece.player];
    const color = playerColor?.color || '#ffffff';
    const darkColor = playerColor?.dark || '#888888';

    ctx.save();

    // 棋子底座（阴影）
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(pos.x + 1, pos.y + 2, size * 0.58, 0, Math.PI * 2);
    ctx.fill();

    // 棋子主体
    const gradient = ctx.createRadialGradient(
      pos.x - size * 0.1, pos.y - size * 0.1, 0,
      pos.x, pos.y, size * 0.55
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, darkColor);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // 棋子边框
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 棋子图标
    const icon = this.pieceIcons[piece.type] || '●';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.55}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText(icon, pos.x, pos.y);

    // 生存模式显示HP
    if (this.gameMode === 'survival' && piece.maxHp > 0) {
      ctx.globalAlpha = 1;
      const hpRatio = piece.hp / piece.maxHp;
      const barWidth = size * 0.8;
      const barHeight = 3;
      const barX = pos.x - barWidth / 2;
      const barY = pos.y + size * 0.5 + 3;

      // 背景
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      // HP条
      ctx.fillStyle = hpRatio > 0.5 ? '#66bb6a' : hpRatio > 0.25 ? '#ffa726' : '#ef5350';
      ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    }

    ctx.restore();
  }

  drawSelection(ctx, x, y) {
    ctx.save();
    const t = Date.now() / 500;
    const pulse = 1 + Math.sin(t) * 0.1;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.7 + Math.sin(t) * 0.3;

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 30);
      const hx = x + this.hexSize * pulse * Math.cos(angle);
      const hy = y + this.hexSize * pulse * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 播放移动动画
   */
  animateMove(pieceId, fromKey, toKey, duration = 300) {
    return new Promise(resolve => {
      const piece = this.pieces.find(p => p.id === pieceId);
      if (!piece) { resolve(); return; }

      const from = this.boardState[fromKey];
      const to = this.boardState[toKey];
      if (!from || !to) { resolve(); return; }

      const startPos = this.cubeToPixel(from.q, from.r);
      const endPos = this.cubeToPixel(to.q, to.r);
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

        // 临时修改棋子位置用于渲染
        // (实际坐标会在动画结束后更新)

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }

        this.render();
      };

      animate();
    });
  }

  /**
   * 启动渲染循环 (用于动态效果)
   */
  startRenderLoop() {
    if (this._renderLoop) return;
    const loop = () => {
      this.render();
      this._renderLoop = requestAnimationFrame(loop);
    };
    this._renderLoop = requestAnimationFrame(loop);
  }

  stopRenderLoop() {
    if (this._renderLoop) {
      cancelAnimationFrame(this._renderLoop);
      this._renderLoop = null;
    }
  }
}

window.BoardRenderer = BoardRenderer;
