/**
 * main.js - 应用入口，连接所有模块
 */

(function () {
  'use strict';

  // ==================== 状态 ====================
  let playerId = localStorage.getItem('playerId');
  let playerName = localStorage.getItem('playerName') || '';
  let selectedMode = 'classic';
  let selectedPlayerCount = 2;
  let roomId = null;

  const network = new NetworkClient();
  const game = new GameClient();

  // ==================== 初始化 ====================

  function init() {
    setupLobbyEvents();
    setupRoomEvents();
    setupGameEvents();

    // 恢复玩家信息
    if (playerId && playerName) {
      document.getElementById('player-name').value = playerName;
      showPlayerInfo();
    }

    // 加载排行榜
    loadLeaderboard();
  }

  // ==================== 大厅事件 ====================

  function setupLobbyEvents() {
    // 保存昵称
    document.getElementById('btn-save-name').addEventListener('click', savePlayerName);
    document.getElementById('player-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') savePlayerName();
    });

    // 模式选择
    document.querySelectorAll('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedMode = card.dataset.mode;
      });
    });

    // 人数选择
    document.querySelectorAll('.player-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.player-count-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedPlayerCount = parseInt(btn.dataset.count);
      });
    });

    // 人机对战
    document.getElementById('btn-create-pve').addEventListener('click', startPVE);

    // 在线对战
    document.getElementById('btn-create-pvp').addEventListener('click', startPVP);

    // 加入房间
    document.getElementById('btn-join-room').addEventListener('click', joinRoom);
    document.getElementById('room-code').addEventListener('keydown', e => {
      if (e.key === 'Enter') joinRoom();
    });

    // 排行榜折叠
    document.querySelectorAll('.toggle-header').forEach(h => {
      h.addEventListener('click', () => {
        const content = h.nextElementSibling;
        content?.classList.toggle('hidden');
        const arrow = h.querySelector('.arrow');
        if (arrow) arrow.textContent = content?.classList.contains('hidden') ? '▼' : '▲';
      });
    });
  }

  async function savePlayerName() {
    const nameInput = document.getElementById('player-name');
    const name = nameInput.value.trim();
    if (!name || name.length > 12) {
      showToast('请输入1-12个字符的昵称', 'error');
      return;
    }

    playerName = name;
    localStorage.setItem('playerName', name);

    try {
      const result = await NetworkClient.createPlayer(name);
      if (result.id) {
        playerId = result.id;
        localStorage.setItem('playerId', playerId);
      }
    } catch (e) {
      // 离线时生成本地ID
      if (!playerId) {
        playerId = 'local_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('playerId', playerId);
      }
    }

    showPlayerInfo();
    showToast('昵称已保存', 'success');
  }

  function showPlayerInfo() {
    document.getElementById('player-setup').querySelector('.form-row').style.display = 'none';
    const infoEl = document.getElementById('player-info');
    infoEl.classList.remove('hidden');
    document.getElementById('display-name').textContent = `👤 ${playerName}`;
    // 让名称可点击编辑
    infoEl.style.cursor = 'pointer';
    infoEl.onclick = () => {
      document.getElementById('player-setup').querySelector('.form-row').style.display = 'flex';
      infoEl.classList.add('hidden');
    };
  }

  async function startPVE() {
    ensurePlayer();

    roomId = 'pve_' + Math.random().toString(36).slice(2, 8);
    connectAndSetupRoom(roomId);

    // 等WebSocket连接后创建游戏并加AI
    network.on('connected', function onConnected() {
      network.off('connected', onConnected);

      const config = getGameConfig();
      network.send({
        type: 'createGame',
        mode: selectedMode,
        playerCount: selectedPlayerCount,
        playerName,
        config,
      });

      // 短暂延迟后添加AI
      setTimeout(() => {
        for (let i = 1; i < selectedPlayerCount; i++) {
          network.send({
            type: 'joinGame',
            playerName: `AI-${i}`,
            isAI: true,
            aiLevel: i <= 1 ? 'medium' : 'hard',
          });
        }

        // 自动准备和开始
        setTimeout(() => {
          network.send({ type: 'ready' });
          setTimeout(() => {
            network.send({ type: 'startGame' });
          }, 500);
        }, 300);
      }, 500);
    });

    showScreen('room-screen');
  }

  async function startPVP() {
    ensurePlayer();

    try {
      const result = await NetworkClient.matchmaking({
        playerId,
        playerName,
        mode: selectedMode,
        playerCount: selectedPlayerCount,
      });

      roomId = result.roomId;

      if (result.action === 'create') {
        // 创建新房间
        await NetworkClient.createRoom({
          roomId,
          mode: selectedMode,
          playerCount: selectedPlayerCount,
          playerName,
        });
        connectAndSetupRoom(roomId);

        network.on('connected', function onConnected() {
          network.off('connected', onConnected);
          network.send({
            type: 'createGame',
            mode: selectedMode,
            playerCount: selectedPlayerCount,
            playerName,
            config: getGameConfig(),
          });
        });
      } else {
        // 加入现有房间
        connectAndSetupRoom(roomId);
        network.on('connected', function onConnected() {
          network.off('connected', onConnected);
          network.send({
            type: 'joinGame',
            playerName,
          });
        });
      }

      showScreen('room-screen');
    } catch (e) {
      showToast('匹配失败，请重试', 'error');
    }
  }

  async function joinRoom() {
    const code = document.getElementById('room-code').value.trim();
    if (!code) {
      showToast('请输入房间号', 'error');
      return;
    }
    ensurePlayer();

    roomId = code;
    connectAndSetupRoom(roomId);

    network.on('connected', function onConnected() {
      network.off('connected', onConnected);
      network.send({
        type: 'joinGame',
        playerName,
      });
    });

    showScreen('room-screen');
  }

  function connectAndSetupRoom(roomId) {
    // 初始化game client
    const canvas = document.getElementById('game-canvas');
    game.init(canvas, network, playerId);

    network.connect(roomId, playerId, playerName);
  }

  function getGameConfig() {
    return {
      enableTerrain: document.getElementById('opt-terrain')?.checked ?? true,
      enableEvents: document.getElementById('opt-events')?.checked ?? true,
      enableAbilities: document.getElementById('opt-abilities')?.checked ?? true,
    };
  }

  function ensurePlayer() {
    if (!playerName) {
      playerName = '玩家' + Math.floor(Math.random() * 9999);
      localStorage.setItem('playerName', playerName);
    }
    if (!playerId) {
      playerId = 'local_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('playerId', playerId);
    }
  }

  // ==================== 等候室事件 ====================

  function setupRoomEvents() {
    document.getElementById('btn-leave-room').addEventListener('click', () => {
      network.disconnect();
      showScreen('lobby-screen');
    });

    document.getElementById('btn-copy-room').addEventListener('click', () => {
      const code = document.getElementById('room-id-display').textContent;
      navigator.clipboard?.writeText(code).then(() => {
        showToast('房间号已复制', 'success');
      }).catch(() => {
        showToast(`房间号: ${code}`, 'info');
      });
    });

    document.getElementById('btn-ready').addEventListener('click', () => {
      network.send({ type: 'ready' });
    });

    document.getElementById('btn-add-ai').addEventListener('click', () => {
      network.send({
        type: 'joinGame',
        playerName: `AI-${Date.now() % 100}`,
        isAI: true,
        aiLevel: 'medium',
      });
    });

    document.getElementById('btn-start-game').addEventListener('click', () => {
      network.send({ type: 'startGame' });
    });

    // 聊天
    document.getElementById('btn-send-chat').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendChat();
    });

    // 游戏开始时切换到游戏界面
    network.on('gameStarted', () => {
      showScreen('game-screen');
    });
  }

  function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    network.send({ type: 'chat', message: msg });
    input.value = '';
  }

  // ==================== 游戏界面事件 ====================

  function setupGameEvents() {
    document.getElementById('btn-end-turn').addEventListener('click', () => {
      network.send({ type: 'endTurn' });
    });

    document.getElementById('btn-surrender').addEventListener('click', () => {
      if (confirm('确定要投降吗？')) {
        network.disconnect();
        showScreen('lobby-screen');
        showToast('你已退出游戏', 'info');
      }
    });

    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      document.getElementById('game-over-modal').classList.add('hidden');
      network.disconnect();
      showScreen('lobby-screen');
    });

    // 法师能力按钮
    document.querySelectorAll('.ability-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        game.activateMageAbility(btn.dataset.terrain);
      });
    });
  }

  // ==================== 排行榜 ====================

  async function loadLeaderboard() {
    try {
      const data = await NetworkClient.getLeaderboard();
      const tbody = document.getElementById('leaderboard-body');
      if (!tbody) return;

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">暂无数据</td></tr>';
        return;
      }

      tbody.innerHTML = data.leaderboard.map((p, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${p.name}</td>
          <td>${p.rating}</td>
          <td>${p.win_rate}%</td>
        </tr>`
      ).join('');
    } catch (e) {
      // 静默失败
    }
  }

  // ==================== 启动 ====================
  init();
})();
