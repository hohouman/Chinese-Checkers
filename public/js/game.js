/**
 * game.js - 游戏客户端逻辑
 * 管理游戏状态、处理交互、协调渲染与网络
 */

class GameClient {
  constructor() {
    this.renderer = null;
    this.network = null;
    this.gameState = null;
    this.gameOver = false;
    this.playerId = null;
    this.selectedPieceId = null;
    this.selectedCell = null;
    this.validMoves = [];
    this.myPlayerIndex = -1;
    this.mageAbilityMode = false;
    this.mageAbilityTerrain = null;
    this.mageAbilityPieceId = null;

    // 棋子类型定义 (镜像服务端)
    this.pieceTypes = {
      pawn: { name: '兵', icon: '●', desc: '基础移动和跳跃' },
      assassin: { name: '刺客', icon: '◆', desc: '可跨越两格障碍' },
      shield: { name: '盾牌', icon: '■', desc: '敌方无法跳过' },
      mage: { name: '法师', icon: '★', desc: '可改变周围地形' },
      scout: { name: '斥候', icon: '▲', desc: '可连续步行两格' },
    };

    this.terrainTypes = {
      normal:     { name: '普通',   color: '#2a2a3e', border: '#3a3a52', desc: '无特殊效果' },
      teleporter: { name: '传送阵', color: '#6c3483', border: '#a569bd', desc: '传送至配对位置' },
      obstacle:   { name: '障碍物', color: '#4a4a5e', border: '#6a6a7e', desc: '阻挡移动路径' },
      speed:      { name: '加速带', color: '#7d6608', border: '#f1c40f', desc: '移动后额外一步' },
      ice:        { name: '冰面',   color: '#1a5276', border: '#5dade2', desc: '滑行无法停留' },
      collapse:   { name: '塌陷区', color: '#7e5109', border: '#e67e22', desc: '踩后塌陷消失' },
    };
  }

  /**
   * 初始化游戏
   */
  init(canvas, network, playerId) {
    // 先设置引用，确保 setupNetworkEvents 可以访问 this.network
    this.network = network;
    this.playerId = playerId;

    // 防止重复初始化时注册多个事件监听
    if (this.renderer) {
      this.renderer.destroy();
    }
    if (this._networkInitialized) {
      // 已有网络事件，跳过重复注册
    } else {
      this._networkInitialized = true;
      this.setupNetworkEvents();
    }

    this.renderer = new BoardRenderer(canvas);

    // 防止重复绑定 Canvas 事件
    if (!this._canvasInitialized) {
      this._canvasInitialized = true;
      this.setupCanvasEvents(canvas);
    }
    this.populateLegends();
  }

  /**
   * 填充棋子和地形图例
   */
  populateLegends() {
    const pieceLegend = document.getElementById('piece-legend');
    if (pieceLegend) {
      pieceLegend.innerHTML = Object.entries(this.pieceTypes).map(([type, info]) =>
        `<div class="legend-item">
          <span class="legend-swatch">${info.icon}</span>
          <span>${info.name} - ${info.desc}</span>
        </div>`
      ).join('');
    }

    const terrainLegend = document.getElementById('terrain-legend');
    if (terrainLegend) {
      terrainLegend.innerHTML = '';
      // 传送阵配对样式（与 renderer 一致）
      const teleporterPairStyles = [
        { color: '#1abc9c', fill: '#0e6655', border: '#1abc9c', label: '①' },
        { color: '#e74c3c', fill: '#78281f', border: '#e74c3c', label: '②' },
        { color: '#f39c12', fill: '#7d6608', border: '#f39c12', label: '③' },
        { color: '#9b59b6', fill: '#4a235a', border: '#9b59b6', label: '④' },
      ];

      for (const [type, info] of Object.entries(this.terrainTypes)) {
        // 传送阵展示所有配对颜色
        if (type === 'teleporter') {
          for (let pi = 0; pi < teleporterPairStyles.length; pi++) {
            const ps = teleporterPairStyles[pi];
            const item = document.createElement('div');
            item.className = 'legend-item terrain-legend-item';

            const cvs = document.createElement('canvas');
            const dpr = window.devicePixelRatio || 1;
            const displaySize = 34;
            cvs.width = displaySize * dpr;
            cvs.height = displaySize * dpr;
            cvs.style.width = displaySize + 'px';
            cvs.style.height = displaySize + 'px';
            cvs.className = 'terrain-preview';
            const ctx = cvs.getContext('2d');
            ctx.scale(dpr, dpr);
            const cx = displaySize / 2, cy = displaySize / 2, hexR = 14;

            // 六边形 - 使用配对颜色
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = Math.PI / 180 * (60 * i - 30);
              const hx = cx + hexR * Math.cos(angle);
              const hy = cy + hexR * Math.sin(angle);
              if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fillStyle = ps.fill;
            ctx.fill();
            ctx.strokeStyle = ps.border;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // 配对圆环 + 标签
            ctx.save();
            ctx.strokeStyle = ps.color;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(cx, cy, hexR * 0.35, 0, Math.PI * 1.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy, hexR * 0.55, Math.PI * 0.5, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = ps.color;
            ctx.font = `bold ${hexR * 0.6}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ps.label, cx, cy);
            ctx.restore();

            item.appendChild(cvs);

            const textEl = document.createElement('div');
            textEl.className = 'terrain-legend-text';
            const pairName = `传送阵 ${ps.label}`;
            textEl.innerHTML = `<span class="terrain-legend-name">${pairName}</span>`
              + `<span class="terrain-legend-desc">${info.desc}</span>`;
            item.appendChild(textEl);

            terrainLegend.appendChild(item);
          }
          continue;
        }

        const item = document.createElement('div');
        item.className = 'legend-item terrain-legend-item';

        // 用 mini canvas 绘制地形六边形预览
        const cvs = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        const displaySize = 34;
        cvs.width = displaySize * dpr;
        cvs.height = displaySize * dpr;
        cvs.style.width = displaySize + 'px';
        cvs.style.height = displaySize + 'px';
        cvs.className = 'terrain-preview';
        const ctx = cvs.getContext('2d');
        ctx.scale(dpr, dpr);
        const cx = displaySize / 2, cy = displaySize / 2, hexR = 14;

        // 绘制六边形
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i - 30);
          const hx = cx + hexR * Math.cos(angle);
          const hy = cy + hexR * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fillStyle = info.color;
        ctx.fill();
        ctx.strokeStyle = info.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 绘制地形特效
        this.drawTerrainPreview(ctx, cx, cy, hexR, type);

        item.appendChild(cvs);

        const textEl = document.createElement('div');
        textEl.className = 'terrain-legend-text';
        textEl.innerHTML = `<span class="terrain-legend-name">${info.name}</span>`
          + `<span class="terrain-legend-desc">${info.desc}</span>`;
        item.appendChild(textEl);

        terrainLegend.appendChild(item);
      }
    }
  }

  /**
   * 在地形图例 mini canvas 上绘制特效
   */
  drawTerrainPreview(ctx, x, y, size, type) {
    switch (type) {
      case 'teleporter':
        ctx.save();
        ctx.strokeStyle = '#a569bd';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.35, 0, Math.PI * 1.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, size * 0.55, Math.PI * 0.5, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      case 'speed':
        ctx.save();
        ctx.fillStyle = '#f1c40f';
        ctx.globalAlpha = 0.8;
        ctx.font = `bold ${size * 0.85}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('»', x, y);
        ctx.restore();
        break;
      case 'obstacle':
        ctx.save();
        ctx.fillStyle = '#6a6a7e';
        ctx.globalAlpha = 0.8;
        ctx.font = `bold ${size * 0.85}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', x, y);
        ctx.restore();
        break;
      case 'ice':
        ctx.save();
        ctx.fillStyle = '#85c1e9';
        ctx.globalAlpha = 0.7;
        ctx.font = `${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('❄', x, y);
        ctx.restore();
        break;
      case 'collapse':
        ctx.save();
        ctx.strokeStyle = '#e67e22';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        break;
    }
  }

  /**
   * 设置 Canvas 事件
   */
  setupCanvasEvents(canvas) {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cell = this.renderer.getCellAtPixel(x, y);
      this.renderer.setHovered(cell);

      // 更新光标
      if (cell && this.gameState) {
        const cellData = this.gameState.board[cell];
        if (cellData?.piece && this.isMyTurn()) {
          canvas.style.cursor = 'pointer';
        } else if (this.validMoves.some(m => m.to === cell)) {
          canvas.style.cursor = 'pointer';
        } else {
          canvas.style.cursor = 'default';
        }
      } else {
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cell = this.renderer.getCellAtPixel(x, y);

      if (!cell || !this.gameState) return;
      this.handleCellClick(cell);
    });

    canvas.addEventListener('mouseleave', () => {
      this.renderer.setHovered(null);
    });
  }

  /**
   * 处理格子点击
   */
  handleCellClick(cellKey) {
    if (!this.isMyTurn()) return;

    const cellData = this.gameState.board[cellKey];
    if (!cellData) return;

    // 法师能力模式
    if (this.mageAbilityMode) {
      this.handleMageAbilityClick(cellKey);
      return;
    }

    // 检查是否点击了合法移动目标
    const targetMove = this.validMoves.find(m => m.to === cellKey);
    if (targetMove && this.selectedPieceId) {
      // 执行移动
      this.network.send({
        type: 'move',
        pieceId: this.selectedPieceId,
        to: cellKey,
      });
      this.clearSelection();
      return;
    }

    // 检查是否点击了自己的棋子
    if (cellData.piece) {
      const piece = this.gameState.pieces.find(p => p.id === cellData.piece);
      if (piece && piece.player === this.myPlayerIndex && piece.active) {
        this.selectPiece(piece, cellKey);
        return;
      }
    }

    // 点击空白处 → 清除选择
    this.clearSelection();
  }

  /**
   * 选择棋子
   */
  selectPiece(piece, cellKey) {
    this.selectedPieceId = piece.id;
    this.selectedCell = cellKey;
    this.renderer.setSelected(cellKey);

    // 请求合法移动 (客户端计算简化版)
    this.calculateValidMoves(piece);

    // 显示棋子信息
    this.showPieceInfo(piece);

    // 如果是法师，管理能力面板状态
    const abilityPanel = document.getElementById('ability-panel');
    const cdTag = document.getElementById('ability-cooldown-tag');
    if (piece.type === 'mage' && this.gameState.config.enableAbilities) {
      abilityPanel?.classList.remove('hidden');
      if (piece.cooldown > 0) {
        // 冷却中 - 禁用按钮
        document.querySelectorAll('.ability-btn').forEach(b => {
          b.classList.add('disabled');
          b.style.pointerEvents = 'none';
          b.style.opacity = '0.4';
        });
        if (cdTag) {
          cdTag.textContent = `冷却 ${piece.cooldown} 回合`;
          cdTag.classList.remove('hidden');
        }
      } else {
        // 可用
        document.querySelectorAll('.ability-btn').forEach(b => {
          b.classList.remove('disabled');
          b.style.pointerEvents = '';
          b.style.opacity = '';
        });
        if (cdTag) cdTag.classList.add('hidden');
      }
    } else {
      abilityPanel?.classList.add('hidden');
    }
  }

  /**
   * 清除选择
   */
  clearSelection() {
    this.selectedPieceId = null;
    this.selectedCell = null;
    this.validMoves = [];
    this.mageAbilityMode = false;
    this.mageAbilityTerrain = null;
    this.renderer.setSelected(null);
    this.renderer.setValidMoves([]);
    document.getElementById('selected-piece-info')?.classList.add('hidden');
    document.getElementById('ability-panel')?.classList.add('hidden');
    document.getElementById('ability-cancel-btn')?.classList.add('hidden');
    document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('active'));
  }

  /**
   * 客户端计算合法移动 (简化版，服务端验证)
   */
  calculateValidMoves(piece) {
    const board = this.gameState.board;
    const pieces = this.gameState.pieces;
    const config = this.gameState.config;
    const moves = [];

    const HEX_DIRS = [
      { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
      { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
    ];

    // 步行
    for (const d of HEX_DIRS) {
      const nq = piece.q + d.q, nr = piece.r + d.r;
      const nk = `${nq},${nr}`;
      const cell = board[nk];
      if (cell && !cell.piece && cell.terrain !== 'obstacle') {
        moves.push({ to: nk, type: 'step' });
      }
    }

    // 跳跃 (递归)
    const visited = new Set();
    visited.add(`${piece.q},${piece.r}`);

    const dfs = (q, r) => {
      for (const d of HEX_DIRS) {
        const midQ = q + d.q, midR = r + d.r;
        const midKey = `${midQ},${midR}`;
        const midCell = board[midKey];
        if (!midCell || !midCell.piece) continue;
        if (midCell.terrain === 'obstacle') continue;

        // 盾牌检查
        if (config.enableAbilities) {
          const midPiece = pieces.find(p => p.id === midCell.piece);
          if (midPiece && midPiece.type === 'shield' && midPiece.player !== piece.player) continue;
        }

        const landQ = q + d.q * 2, landR = r + d.r * 2;
        const landKey = `${landQ},${landR}`;
        const landCell = board[landKey];
        if (!landCell || landCell.piece || landCell.terrain === 'obstacle') continue;
        if (visited.has(landKey)) continue;

        visited.add(landKey);
        moves.push({ to: landKey, type: 'hop' });
        dfs(landQ, landR);
      }
    };

    dfs(piece.q, piece.r);

    // 刺客特殊跳
    if (piece.type === 'assassin' && config.enableAbilities !== false) {
      for (const d of HEX_DIRS) {
        const m1q = piece.q + d.q, m1r = piece.r + d.r;
        const m2q = piece.q + d.q * 2, m2r = piece.r + d.r * 2;
        const lq = piece.q + d.q * 3, lr = piece.r + d.r * 3;
        const m1k = `${m1q},${m1r}`, m2k = `${m2q},${m2r}`, lk = `${lq},${lr}`;
        if (board[m1k]?.piece && board[m2k]?.piece &&
            board[lk] && !board[lk].piece && board[lk].terrain !== 'obstacle') {
          if (!moves.some(m => m.to === lk)) {
            moves.push({ to: lk, type: 'assassin_leap' });
          }
        }
      }
    }

    // 斥候双步
    if (piece.type === 'scout' && config.enableAbilities !== false) {
      const startKey = `${piece.q},${piece.r}`;
      for (const d1 of HEX_DIRS) {
        const n1q = piece.q + d1.q, n1r = piece.r + d1.r;
        const n1k = `${n1q},${n1r}`;
        if (!board[n1k] || board[n1k].piece || board[n1k].terrain === 'obstacle') continue;
        for (const d2 of HEX_DIRS) {
          const n2q = n1q + d2.q, n2r = n1r + d2.r;
          const n2k = `${n2q},${n2r}`;
          if (n2k === startKey) continue;
          if (!board[n2k] || board[n2k].piece || board[n2k].terrain === 'obstacle') continue;
          if (!moves.some(m => m.to === n2k)) {
            moves.push({ to: n2k, type: 'scout_dash' });
          }
        }
      }
    }

    this.validMoves = moves;
    this.renderer.setValidMoves(moves);
  }

  /**
   * 显示棋子信息
   */
  showPieceInfo(piece) {
    const info = document.getElementById('selected-piece-info');
    if (!info) return;

    const type = this.pieceTypes[piece.type] || this.pieceTypes.pawn;
    const player = this.gameState.players.find(p => p.index === piece.player);
    const color = player?.color?.color || '#fff';

    let abilityLine = '';
    if (piece.type === 'mage') {
      if (piece.cooldown > 0) {
        abilityLine = `<div class="piece-ability-status cd">🔮 技能冷却中 (${piece.cooldown}回合)</div>`;
      } else if (this.gameState.config.enableAbilities) {
        abilityLine = `<div class="piece-ability-status ready">🔮 地形塑造就绪 ▶</div>`;
      }
    } else if (piece.cooldown > 0) {
      abilityLine = `<div style="color:var(--text-dim);font-size:11px">技能冷却: ${piece.cooldown}回合</div>`;
    }

    info.innerHTML = `
      <div class="piece-name" style="color:${color}">${type.icon} ${type.name}</div>
      <div class="piece-desc">${type.desc}</div>
      ${this.gameState.mode === 'survival' ? `<div class="piece-hp">HP: ${piece.hp}/${piece.maxHp}</div>` : ''}
      ${abilityLine}
    `;
    info.classList.remove('hidden');
  }

  /**
   * 处理法师能力点击
   */
  handleMageAbilityClick(cellKey) {
    if (!this.mageAbilityPieceId || !this.mageAbilityTerrain) return;

    this.network.send({
      type: 'ability',
      pieceId: this.mageAbilityPieceId,
      targetKey: cellKey,
      terrain: this.mageAbilityTerrain,
    });

    this.mageAbilityMode = false;
    this.mageAbilityTerrain = null;
    this.clearSelection();
  }

  /**
   * 设置法师能力模式
   */
  activateMageAbility(terrain) {
    if (!this.selectedPieceId) return;
    const piece = this.gameState.pieces.find(p => p.id === this.selectedPieceId);
    if (!piece || piece.cooldown > 0) return;

    this.mageAbilityMode = true;
    this.mageAbilityTerrain = terrain;
    this.mageAbilityPieceId = this.selectedPieceId;

    // 显示取消按钮
    document.getElementById('ability-cancel-btn')?.classList.remove('hidden');

    // 高亮可以目标的相邻格子（用特殊类型标识法师能力目标）
    const HEX_DIRS = [
      { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
      { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
    ];

    const targets = [];
    for (const d of HEX_DIRS) {
      const nk = `${piece.q + d.q},${piece.r + d.r}`;
      const cell = this.gameState.board[nk];
      if (cell && cell.zone === 'center' && !cell.piece) {
        targets.push({ to: nk, type: 'mage_target' });
      }
    }
    this.renderer.setValidMoves(targets);

    const terrainName = this.terrainTypes[terrain]?.name || terrain;
    showToast(`选择相邻空格放置「${terrainName}」`, 'info');
  }

  /**
   * 取消法师能力选择
   */
  cancelMageAbility() {
    this.mageAbilityMode = false;
    this.mageAbilityTerrain = null;
    document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('ability-cancel-btn')?.classList.add('hidden');
    // 恢复移动高亮
    if (this.selectedPieceId) {
      const piece = this.gameState.pieces.find(p => p.id === this.selectedPieceId);
      if (piece) this.calculateValidMoves(piece);
    }
  }

  // ==================== 网络事件处理 ====================

  setupNetworkEvents() {
    this.network.on('gameState', (data) => this.onGameState(data));
    this.network.on('gameCreated', (data) => this.onGameState(data));
    this.network.on('gameStarted', (data) => this.onGameStarted(data));
    this.network.on('playerJoined', (data) => this.onPlayerJoined(data));
    this.network.on('playerReconnected', (data) => this.onPlayerReconnected(data));
    this.network.on('playerReady', (data) => this.onPlayerReady(data));
    this.network.on('moved', (data) => this.onMoved(data));
    this.network.on('turnChanged', (data) => this.onTurnChanged(data));
    this.network.on('abilityUsed', (data) => this.onAbilityUsed(data));
    this.network.on('randomEvent', (data) => this.onRandomEvent(data));
    this.network.on('scoresUpdated', (data) => this.onScoresUpdated(data));
    this.network.on('extraTurn', (data) => this.onExtraTurn(data));
    this.network.on('gameOver', (data) => this.onGameOver(data));
    this.network.on('chat', (data) => this.onChat(data));
    this.network.on('error', (data) => showToast(data.message, 'error'));
    this.network.on('playerDisconnected', (data) => {
      showToast(`${data.name} 断开连接`, 'info');
    });
  }

  onGameState(data) {
    const state = data.state;
    if (!state) return;
    this.gameState = state;

    if (data.yourId) this.playerId = data.yourId;

    // 找到自己的玩家索引
    const me = state.players.find(p => p.id === this.playerId);
    if (me) this.myPlayerIndex = me.index;

    this.updateRoomUI(state);

    if (state.status === 'playing' && state.board) {
      // 重连到进行中的游戏时，切换到游戏界面
      showScreen('game-screen');
      this.renderer.resize();
      this.updateGameUI(state);
      this.renderer.startRenderLoop();
    }
  }

  onGameStarted(data) {
    this.gameState = data.state;
    showScreen('game-screen');
    // 重新计算 Canvas 尺寸（从隐藏切换到可见后必须重新测量）
    this.renderer.resize();
    this.updateGameUI(data.state);
    showToast('游戏开始！', 'success');
    this.renderer.startRenderLoop();
  }

  onPlayerJoined(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateRoomUI(data.state);
    }
    showToast(`${data.player?.name || '玩家'} 加入房间`, 'info');
  }

  onPlayerReconnected(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateRoomUI(data.state);
    }
    showToast(`${data.name || '玩家'} 重新连接`, 'info');
  }

  onPlayerReady(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateRoomUI(data.state);
    }
  }

  onMoved(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateGameUI(data.state);
    }

    // 效果反馈
    if (data.effects) {
      for (const eff of data.effects) {
        if (eff.type === 'teleport') addEventLog(`✨ 传送！`);
        if (eff.type === 'slide') addEventLog(`❄ 冰面滑行！`);
        if (eff.type === 'damage') addEventLog(`⚔️ 造成 ${eff.damage} 点伤害`);
        if (eff.type === 'eliminated') addEventLog(`💀 棋子被消灭！`);
      }
    }

    if (data.isAI) {
      const playerName = this.gameState?.players.find(p => p.index === data.playerIndex)?.name || 'AI';
      addEventLog(`🤖 ${playerName} 移动了棋子`);
    }
  }

  onTurnChanged(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateGameUI(data.state);
    }
    this.clearSelection();

    if (this.isMyTurn()) {
      showToast('轮到你了！', 'info');
    }

    // 更新回合显示
    document.getElementById('turn-num').textContent = data.turn || '?';
    this.updateCurrentPlayerDisplay();
  }

  onAbilityUsed(data) {
    if (data.state) {
      this.gameState = data.state;
      this.updateGameUI(data.state);
    }
    const terrainInfo = this.terrainTypes[data.terrain];
    const terrainName = terrainInfo?.name || data.terrain;
    const aiTag = data.isAI ? ' (AI)' : '';
    showEventPopup('🔮', '地形塑造' + aiTag, `法师将地形变为「${terrainName}」`, '', 'ability');
    addEventLog(`🔮 法师改变了地形 → ${terrainName}`);
  }

  onRandomEvent(data) {
    const event = data.event;
    if (!event) return;

    // 构建效果详情文本
    const detail = this.buildEventDetail(event);
    showEventPopup(event.icon || '⚡', event.name || '随机事件', event.description || '', detail, event.type);
    addEventLog(`[回合${data.turn}] ${event.icon || ''} ${event.name}: ${event.description}`);

    // 刷新棋盘（延迟以让弹窗先展示）
    if (this.gameState?.board && event.changes) {
      // 在前端立即应用地形变更
      for (const ch of event.changes) {
        if (ch.type === 'terrainChange' && this.gameState.board[ch.key]) {
          this.gameState.board[ch.key].terrain = ch.terrain;
        }
      }
      setTimeout(() => {
        this.updateGameUI(this.gameState);
      }, 600);
    }
  }

  /**
   * 根据随机事件的 changes 构建中文效果摘要
   */
  buildEventDetail(event) {
    const changes = event.changes;
    if (!changes || changes.length === 0) return '';
    const parts = [];
    const terrainMap = { obstacle: '障碍物', speed: '加速带', teleporter: '传送阵', ice: '冰面', normal: '普通' };
    let terrainChanges = 0, heals = 0, displaced = 0, eliminated = 0;
    for (const ch of changes) {
      if (ch.type === 'terrainChange') terrainChanges++;
      if (ch.type === 'heal') heals++;
      if (ch.type === 'displaced') displaced++;
      if (ch.type === 'eliminated') eliminated++;
    }
    if (terrainChanges > 0) {
      const first = changes.find(c => c.type === 'terrainChange');
      const tn = terrainMap[first?.terrain] || first?.terrain;
      parts.push(`${terrainChanges} 格变为${tn}`);
    }
    if (heals > 0) parts.push(`${heals} 个棋子恢复HP`);
    if (displaced > 0) parts.push(`${displaced} 个棋子被挤开`);
    if (eliminated > 0) parts.push(`${eliminated} 个棋子被消灭`);
    return parts.join('，');
  }

  onScoresUpdated(data) {
    if (this.gameState) {
      this.gameState.scores = data.scores;
      this.updatePlayersPanel();
    }
  }

  onExtraTurn(data) {
    const player = this.gameState?.players.find(p => p.index === data.playerIndex);
    showToast(`${player?.name || '玩家'} 获得额外回合！（加速带）`, 'info');
    addEventLog(`⚡ ${player?.name || '玩家'} 获得额外回合`);

    document.getElementById('btn-end-turn')?.classList.remove('hidden');
  }

  onGameOver(data) {
    // 不停止渲染，让玩家可以继续查看棋盘
    this.gameOver = true;

    const winner = data.winner;
    const ranking = data.ranking || [];
    const reason = data.reason;

    const reasonText = {
      classic_complete: '率先完成棋子转移',
      points_target_reached: '率先达到目标积分',
      last_standing: '最后存活',
      draw: '平局',
    };

    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('game-over-title');
    const body = document.getElementById('game-over-body');

    if (winner === this.myPlayerIndex) {
      title.textContent = '🎉 胜利！';
    } else if (winner >= 0) {
      const winnerPlayer = this.gameState?.players.find(p => p.index === winner);
      title.textContent = `${winnerPlayer?.name || '对手'} 获胜`;
    } else {
      title.textContent = '游戏结束';
    }

    body.innerHTML = `
      <p style="color:var(--text-dim);margin-bottom:12px">${reasonText[reason] || reason}</p>
      <table class="ranking-table">
        ${ranking.map((r, i) => `
          <tr class="rank-${i + 1}">
            <td>#${i + 1}</td>
            <td>${r.name} ${r.isAI ? '🤖' : ''}</td>
            <td>${r.score > 0 ? r.score + '分' : ''}</td>
            <td>${r.piecesAlive}棋存活</td>
          </tr>
        `).join('')}
      </table>
    `;

    modal.classList.remove('hidden');
  }

  onChat(data) {
    addChatMessage(data.playerId, data.message, this.gameState?.players);
  }

  // ==================== UI 更新 ====================

  isMyTurn() {
    return this.gameState &&
      this.gameState.status === 'playing' &&
      this.gameState.currentPlayer === this.myPlayerIndex;
  }

  updateRoomUI(state) {
    document.getElementById('room-id-display').textContent = this.network.roomId || '';
    document.getElementById('room-mode-display').textContent = {
      classic: '🏁 经典模式',
      points: '💎 积分模式',
      survival: '⚔️ 生存模式',
    }[state.mode] || state.mode;
    document.getElementById('room-count-display').textContent = `${state.players.length}/${state.playerCount}人`;

    // 玩家槽位
    const slotsEl = document.getElementById('player-slots');
    if (!slotsEl) return;

    const positions = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
    const pos = positions[state.playerCount] || positions[2];

    slotsEl.innerHTML = pos.map(idx => {
      const player = state.players.find(p => p.index === idx);
      const colors = [
        { name: '红方', color: '#e74c3c' },
        { name: '蓝方', color: '#3498db' },
        { name: '绿方', color: '#27ae60' },
        { name: '紫方', color: '#8e44ad' },
        { name: '橙方', color: '#e67e22' },
        { name: '青方', color: '#16a085' },
      ];

      if (player) {
        const aiLevelNames = { easy: '简单', medium: '中等', hard: '困难' };
        const aiTag = player.isAI ? `🤖 <span style="font-size:11px;color:var(--text-dim)">${aiLevelNames[player.aiLevel] || '中等'}</span>` : '';
        return `<div class="player-slot occupied ${player.ready ? 'ready' : ''}">
          <div class="slot-color" style="background:${colors[idx]?.color || '#888'}"></div>
          <div class="slot-name">${player.name} ${aiTag}</div>
          <div class="slot-status">${player.ready ? '✓ 已准备' : '等待准备...'}</div>
        </div>`;
      }
      return `<div class="player-slot">
        <div class="slot-color" style="background:${colors[idx]?.color || '#888'}"></div>
        <div class="slot-name" style="color:var(--text-dim)">等待加入...</div>
        <div class="slot-status">${colors[idx]?.name || ''}</div>
      </div>`;
    }).join('');

    // 检查是否所有人都准备了
    const allReady = state.players.length >= 2 && state.players.every(p => p.ready || p.isAI);
    const startBtn = document.getElementById('btn-start-game');
    if (allReady && state.players.find(p => p.id === this.playerId)) {
      startBtn?.classList.remove('hidden');
    } else {
      startBtn?.classList.add('hidden');
    }
  }

  updateGameUI(state) {
    if (!state?.board) return;

    // 构建玩家颜色映射
    const colorMap = {};
    const colors = [
      { color: '#e74c3c', dark: '#922b21', light: '#fadbd8' },
      { color: '#3498db', dark: '#1a5276', light: '#d4e6f1' },
      { color: '#27ae60', dark: '#1e8449', light: '#d5f5e3' },
      { color: '#8e44ad', dark: '#6c3483', light: '#e8daef' },
      { color: '#e67e22', dark: '#af601a', light: '#fdebd0' },
      { color: '#16a085', dark: '#0e6655', light: '#d1f2eb' },
    ];
    for (const p of state.players || []) {
      colorMap[p.index] = colors[p.index] || colors[0];
    }

    this.renderer.updateState(state.board, state.pieces, colorMap, state.mode);
    this.updatePlayersPanel();
    this.updateCurrentPlayerDisplay();

    document.getElementById('turn-num').textContent = state.turn || 1;

    // 回合结束按钮
    const endTurnBtn = document.getElementById('btn-end-turn');
    if (this.isMyTurn() && state.extraTurn) {
      endTurnBtn?.classList.remove('hidden');
    } else {
      endTurnBtn?.classList.add('hidden');
    }
  }

  updatePlayersPanel() {
    const panel = document.getElementById('players-panel');
    if (!panel || !this.gameState) return;

    const state = this.gameState;
    panel.innerHTML = state.players.map(p => {
      const colors = [
        '#e74c3c', '#3498db', '#27ae60', '#8e44ad', '#e67e22', '#16a085'
      ];
      const isActive = state.currentPlayer === p.index;
      const alivePieces = state.pieces?.filter(pc => pc.player === p.index && pc.active).length || 0;
      const score = state.scores?.[p.index] || 0;

      const aiLevelNames = { easy: '简单', medium: '中等', hard: '困难' };
      const aiTag = p.isAI ? `🤖<span style="font-size:10px;opacity:0.7">${aiLevelNames[p.aiLevel] || ''}</span>` : '';

      return `<div class="player-row ${isActive ? 'active-turn' : ''}">
        <span class="player-dot" style="background:${colors[p.index] || '#888'}"></span>
        <span class="player-name">${p.name} ${aiTag} ${p.id === this.playerId ? '(你)' : ''}</span>
        <span class="player-pieces">${alivePieces}棋</span>
        ${state.mode === 'points' ? `<span class="player-score">${score}分</span>` : ''}
      </div>`;
    }).join('');
  }

  updateCurrentPlayerDisplay() {
    const el = document.getElementById('current-player-display');
    if (!el || !this.gameState) return;

    const current = this.gameState.players.find(p => p.index === this.gameState.currentPlayer);
    const colors = ['#e74c3c', '#3498db', '#27ae60', '#8e44ad', '#e67e22', '#16a085'];

    if (current) {
      el.textContent = this.isMyTurn() ? '你的回合' : `${current.name} 的回合`;
      el.style.color = colors[current.index] || '#fff';
    }
  }
}

// ==================== 全局辅助函数 ====================

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showEventPopup(icon, title, desc = '', detail = '', eventType = '') {
  const popup = document.getElementById('event-popup');
  if (!popup) return;
  document.getElementById('event-popup-icon').textContent = icon;
  document.getElementById('event-popup-text').textContent = title;
  const descEl = document.getElementById('event-popup-desc');
  const detailEl = document.getElementById('event-popup-detail');
  if (descEl) descEl.textContent = desc;
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.style.display = detail ? 'block' : 'none';
  }
  // 按事件类型设置颜色主题
  const content = popup.querySelector('.event-popup-content');
  if (content) {
    content.className = 'event-popup-content';
    if (eventType) content.classList.add('event-type-' + eventType);
    // 重新触发动画
    content.style.animation = 'none';
    content.offsetHeight; // reflow
    content.style.animation = '';
  }
  popup.classList.remove('hidden');
  clearTimeout(showEventPopup._timer);
  showEventPopup._timer = setTimeout(() => popup.classList.add('hidden'), 4000);
}

function addEventLog(text) {
  const list = document.getElementById('event-list');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'event-item';
  item.textContent = text;
  list.prepend(item);
  // 保持最多30条
  while (list.children.length > 30) list.removeChild(list.lastChild);
}

function addChatMessage(playerId, message, players) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const player = players?.find(p => p.id === playerId);
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-author" style="color:${player?.color?.color || '#aaa'}">${player?.name || '???'}:</span>${escapeHtml(message)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.GameClient = GameClient;
window.showScreen = showScreen;
window.showToast = showToast;
