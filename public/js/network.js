/**
 * network.js - WebSocket 客户端
 * 处理与服务器的实时通信
 */

class NetworkClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.roomId = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.pingInterval = null;
  }

  /**
   * 注册消息处理器
   */
  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  off(type, handler) {
    if (this.handlers[type]) {
      this.handlers[type] = this.handlers[type].filter(h => h !== handler);
    }
  }

  emit(type, data) {
    const list = this.handlers[type] || [];
    for (const h of list) {
      try { h(data); } catch (e) { console.error('Handler error:', e); }
    }
  }

  /**
   * 连接到游戏房间
   */
  connect(roomId, playerId, playerName) {
    this.roomId = roomId;
    this.playerId = playerId;
    this.maxReconnectAttempts = 5; // 重置重连次数（disconnect时被设为0）

    // 关闭已有连接
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this.stopPing();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/api/rooms/${roomId}/ws?playerId=${playerId}&name=${encodeURIComponent(playerName)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.emit('connected', {});
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type, data);
        this.emit('message', data);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      this.stopPing();
      this.emit('disconnected', { code: event.code, reason: event.reason });
      this.tryReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', { message: '连接错误' });
    };
  }

  /**
   * 发送消息
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stopPing();
    this.maxReconnectAttempts = 0; // 阻止重连
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => {
      if (this.roomId && this.playerId) {
        this.connect(this.roomId, this.playerId, localStorage.getItem('playerName') || '玩家');
      }
    }, delay);
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 25000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ==================== API 调用 ====================

  static async createPlayer(name) {
    const res = await fetch('/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  }

  static async getPlayer(id) {
    const res = await fetch(`/api/player?id=${id}`);
    return res.json();
  }

  static async createRoom(data) {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  static async matchmaking(data) {
    const res = await fetch('/api/matchmaking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  static async getLeaderboard() {
    const res = await fetch('/api/leaderboard');
    return res.json();
  }

  static async getHistory(playerId) {
    const res = await fetch(`/api/history/${playerId}`);
    return res.json();
  }
}

window.NetworkClient = NetworkClient;
