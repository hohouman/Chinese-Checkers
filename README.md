# 星陨跳棋 - 改版策略对战游戏

基于 **Cloudflare** 全栈方案（Workers with Assets + Durable Objects + D1 + KV + R2）的改版跳棋在线对战游戏。

> 🌐 **在线体验**：[https://chinese-checkers-online.leidun.pp.ua/](https://chinese-checkers-online.leidun.pp.ua/)

## 🎮 游戏特色

### 三大游戏模式
- **🏁 经典模式**：将所有棋子移动到对面目标区域
- **💎 积分模式**：占领高价值资源地块获取积分
- **⚔️ 生存模式**：击败敌方棋子，最后存活获胜

### 五种棋子能力
| 棋子 | 图标 | 特殊能力 |
|------|------|----------|
| 兵 | ● | 基础移动和跳跃 |
| 刺客 | ◆ | 跨越两格障碍，生存模式攻击力×2 |
| 盾牌 | ■ | 敌方无法跳过此棋子 |
| 法师 | ★ | 移动后可改变相邻地砖属性 |
| 斥候 | ▲ | 一回合内可步行两格 |

### 动态地形系统
- **传送阵** 🌀：踏入后传送到关联传送阵
- **障碍物** 🪨：不可通行
- **加速带** ⚡：获得额外一次移动机会
- **冰面** ❄️：沿移动方向滑行
- **塌陷区** ⚠️：特定回合后变为障碍物

### 随机事件
每隔数回合触发随机事件：区域塌陷、地脉祝福、次元裂隙、寒冰风暴、地震等。

### 支持
- 2-6人在线对战
- PvE 人机对战（简单/中等/困难 AI）
- 实时 WebSocket 通信

### 自动清理机制
- **Durable Object alarm**：游戏结束 10 分钟后、所有玩家断连 30 分钟后、空闲房间 2 小时未开始后自动清理房间存储
- **Cron Trigger**：每天凌晨 3 点自动清理 D1 中 90 天前的对局记录和 180 天未活跃的空玩家
- **KV TTL**：匹配队列 2 分钟过期、活跃房间列表 1 小时过期、玩家会话 30 天过期

## 🏗 技术架构

```
┌─────────────────────────────────────────┐
│                 前端                      │
│  HTML Canvas 渲染 + WebSocket 客户端      │
│        (Cloudflare Workers Assets)       │
├─────────────────────────────────────────┤
│           Cloudflare Worker              │
│  HTTP API + 路由 + CORS + Cron Trigger   │
├────────┬────────────┬───────────────────┤
│   D1   │     KV     │  Durable Objects  │
│ 玩家   │  会话管理    │  游戏房间          │
│ 排行榜  │  匹配队列   │  WebSocket管理     │
│ 游戏记录│  活跃房间   │  实时游戏逻辑       │
│        │            │  alarm 自动清理     │
├────────┴────────────┴───────────────────┤
│          R2 对象存储                      │
│        游戏回放/地图数据（预留）            │
└─────────────────────────────────────────┘
```

## 🚀 CI/CD

项目配置了两个 GitHub Actions，推送到 `main` 分支后自动完成构建和部署：

- **build.yml** — 构建 `public/_worker.js` 并提交到仓库
- **deploy.yml** — 构建 + `wrangler deploy` 部署到 Cloudflare Workers

> 需要在 GitHub 仓库 Settings → Secrets 中配置 `CLOUDFLARE_API_TOKEN`。

## 📦 部署指南

### 前提条件
- Node.js 18+
- Cloudflare 账号
- Wrangler CLI

### 1. 安装依赖

```bash
cd Chinese-Checkers
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create chinese-checkers-db
```

将返回的 `database_id` 填入 `wrangler.toml` 中 `[[d1_databases]]` 的 `database_id`。

### 4. 创建 KV 命名空间

```bash
npx wrangler kv namespace create SESSIONS
```

将返回的 `id` 填入 `wrangler.toml` 中 `[[kv_namespaces]]` 的 `id`。

### 5. 创建 R2 存储桶

```bash
npx wrangler r2 bucket create chinese-checkers-storage
```

### 6. 初始化数据库

```bash
# 本地开发
npm run db:init:local

# 远程
npm run db:init
```

### 7. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787` 即可开始游戏。

### 8. 部署到 Cloudflare

```bash
npm run deploy
```

或直接推送到 GitHub `main` 分支，由 Action 自动部署。

## 🎯 项目结构

```
Chinese-Checkers/
├── .github/workflows/
│   ├── build.yml          # CI: 构建 _worker.js
│   └── deploy.yml         # CD: 构建 + 部署到 Cloudflare
├── wrangler.toml          # Cloudflare Worker 配置
├── package.json           # 项目配置 & 脚本
├── schema.sql             # D1 数据库结构
├── .gitignore
├── src/
│   ├── index.js           # Worker 主入口 (API路由 + Cron)
│   ├── game-room.js       # Durable Object (游戏房间 + alarm清理)
│   └── game/
│       ├── board.js       # 六角星棋盘 & 坐标系统
│       ├── pieces.js      # 棋子类型 & 能力系统
│       ├── terrain.js     # 动态地形系统
│       ├── rules.js       # 移动规则 & 验证引擎
│       ├── ai.js          # AI 对手逻辑
│       ├── events.js      # 随机事件系统
│       └── modes.js       # 游戏模式 & 胜利条件
└── public/                # 静态资源 (Workers Assets)
    ├── .assetsignore      # 排除 _worker.js 被当作静态资源
    ├── index.html         # 主页面
    ├── style.css          # 样式
    └── js/
        ├── main.js        # 应用入口
        ├── game.js        # 游戏客户端逻辑
        ├── renderer.js    # Canvas 棋盘渲染器
        └── network.js     # WebSocket 客户端
```

## 📝 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/player` | 创建玩家 |
| GET | `/api/player?id=xxx` | 获取玩家信息 |
| POST | `/api/rooms` | 创建房间 |
| GET | `/api/rooms` | 房间列表（自动过滤过期房间） |
| POST | `/api/matchmaking` | 快速匹配 |
| GET | `/api/leaderboard` | 排行榜 |
| GET | `/api/history/:playerId` | 游戏历史 |
| POST | `/api/admin/cleanup` | 手动触发数据清理 |
| WS | `/api/rooms/:roomId/ws` | WebSocket连接 |

## 🔧 WebSocket 消息协议

### 客户端 → 服务端
- `createGame` - 创建游戏
- `joinGame` - 加入游戏
- `ready` - 准备/取消准备
- `startGame` - 开始游戏
- `move` - 移动棋子 `{pieceId, to}`
- `ability` - 使用技能 `{pieceId, targetKey, terrain}`
- `endTurn` - 结束回合
- `chat` - 聊天消息

### 服务端 → 客户端
- `gameState` - 完整游戏状态
- `gameCreated` - 游戏已创建
- `gameStarted` - 游戏开始
- `playerJoined` - 玩家加入
- `playerReady` - 玩家准备
- `playerDisconnected` - 玩家断连
- `moved` - 棋子移动
- `turnChanged` - 回合切换
- `abilityUsed` - 技能使用
- `randomEvent` - 随机事件触发
- `collapseEvent` - 塌陷事件
- `scoresUpdated` - 积分更新
- `extraTurn` - 获得额外回合
- `gameOver` - 游戏结束
