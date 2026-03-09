# 星陨跳棋 - 改版策略对战游戏

基于 **Cloudflare** 全栈方案（Workers with Assets + Durable Objects + D1 + KV + R2）的改版跳棋在线对战游戏。

> 🌐 **在线体验**：[https://chinese-checkers-online.leidun.pp.ua/](https://chinese-checkers-online.leidun.pp.ua/)

## 🎮 游戏特色

### 棋盘

星形六角棋盘，使用立方坐标系 $(q, r, s)$，其中 $q + r + s = 0$。

- **中心六边形**：半径 4 的正六边形区域（`center` 区域）
- **六个三角臂**：每个臂 10 格（`home_0` ~ `home_5`），分别对应 6 个玩家的母区
- **总计 121 格**
- **目标区**：每位玩家的目标区是对面的三角臂（索引差 3，即 `home_{(i+3)%6}`）

**玩家位置分配**：

| 人数 | 使用位置 |
|------|----------|
| 2人  | 0, 3（正对面） |
| 3人  | 0, 2, 4（间隔120°） |
| 4人  | 0, 1, 3, 4 |
| 6人  | 0, 1, 2, 3, 4, 5（全部） |

### 三大游戏模式

#### 🏁 经典模式

将所有棋子从母区移动到对面目标区域即可获胜。

| 参数 | 默认值 |
|------|--------|
| 事件频率 | 每 6 回合 |
| 回合时限 | 60 秒 |
| 棋子能力 | 开启 |
| 地形/事件 | 开启 |

**胜利条件**：某玩家的全部活跃棋子都位于目标区域内。

#### 💎 积分模式

占领高价值资源地块获取积分，率先达到目标分数获胜。

| 参数 | 默认值 |
|------|--------|
| 目标积分 | 50 分 |
| 资源地块数 | 8 个 |
| 事件频率 | 每 5 回合 |
| 回合时限 | 45 秒 |

**积分规则**：
- 资源地块随机分布在中心区域，价值为 1 / 2 / 3 分（30% 概率为高价值 3 分）
- 每回合结束时，棋子所在的资源格自动计入该玩家积分
- **胜利条件**：率先累计达到目标积分。

#### ⚔️ 生存模式

击败敌方棋子，最后存活的玩家获胜。

| 参数 | 默认值 |
|------|--------|
| 事件频率 | 每 4 回合 |
| 回合时限 | 45 秒 |

**战斗规则**：
- **跳跃伤害**：跳过敌方棋子时自动造成 1 点伤害（刺客造成 2 点）
- 棋子 HP 降至 0 时被消灭并从棋盘移除
- **胜利条件**：只剩一位玩家拥有活跃棋子；若全部消灭则平局。

### 五种棋子

每位玩家初始拥有 **10 枚棋子**：6 兵 + 1 刺客 + 1 盾牌 + 1 法师 + 1 斥候。

| 棋子 | 图标 | HP | 能力名 | 能力说明 | 冷却 |
|------|------|-----|--------|----------|------|
| **兵** | ● | 2 | — | 标准移动和跳跃，无特殊能力 | — |
| **刺客** | ◆ | 1 | 暗杀突袭 | 可跳过连续两个相邻棋子落在第三格（`assassin_leap`）；生存模式攻击力×2 | 0（被动） |
| **盾牌** | ■ | 4 | 坚壁 | 敌方棋子无法跳过此棋子（被动阻挡） | 0（被动） |
| **法师** | ★ | 2 | 地形塑造 | 移动后可将一个相邻普通地砖变为 `speed` / `ice` / `obstacle`，或将特殊地形还原为 `normal` | 3 回合 |
| **斥候** | ▲ | 1 | 疾行 | 一回合内可连续步行两格（不需跳跃，经过中间空格到达目标） | 0（被动） |

### 移动规则

1. **步行**（`step`）：移动到任意一个相邻空格（6 个方向之一）
2. **跳跃**（`hop`）：跳过相邻的一枚棋子（友方/敌方均可），落在该棋子对面的空格上。可**连续跳跃**（链式跳，递归查找所有合法跳跃路径）
3. **刺客突跃**（`assassin_leap`）：沿一个方向连续跳过两枚棋子，落在第三格（刺客专属）
4. **斥候疾行**（`scout_dash`）：连续走两步（两次步行，中间格必须为空，不能回到原点）

**跳跃约束**：
- 中间被跳过的格子必须有棋子且该格非障碍
- 落点格必须为空且非障碍
- 敌方盾牌棋子**不能被跳过**（`shield` 被动能力，在能力开启时生效）

### 六种地形

地形在游戏开始时随机生成于**中心区域**（不会出现在三角臂/母区内）。

| 地形 | 颜色标识 | 可通行 | 效果 | 默认数量 |
|------|---------|--------|------|---------|
| **普通** | `#f5e6ca` | ✅ | 无特殊效果 | — |
| **传送阵** | `#9b59b6` | ✅ | 踏入后传送到关联的传送阵（成对出现） | 2 对 (4格) |
| **障碍物** | `#5d6d7e` | ❌ | 不可通行，不可落脚 | 4 格 |
| **加速带** | `#f1c40f` | ✅ | 踏入后获得**额外一次移动机会**（本回合可再动一次） | 3 格 |
| **冰面** | `#85c1e9` | ✅ | 棋子沿移动方向**滑行一格**（若下一格可用） | 2 格 |
| **塌陷区** | `#e67e22` | ✅ | 在随机指定回合（5~20回合）后自动**塌陷为障碍物** | 2 格 |

**地形效果处理顺序**：移动 → 传送 → 冰面滑行 → 加速带额外回合

**塌陷区规则**：
- 塌陷触发时，若上面有棋子，尝试弹出到相邻空格
- 若所有相邻格都不可用，棋子被消灭

**法师地形塑造**：
- 只能改变**中心区域**的地砖
- 普通 → `speed` / `ice` / `obstacle`（三选一）
- 非障碍的特殊地形 → 还原为 `normal`
- 使用后进入 **3 回合冷却**

### 六种随机事件

前 3 回合不触发事件。之后每隔若干回合（由模式配置决定）随机触发一个：

| 事件 | 图标 | 效果 | 备注 |
|------|------|------|------|
| **区域塌陷** | 💥 | 一个中心区空格变为障碍物 | 上面有棋子会被弹出或消灭 |
| **地脉祝福** | ✨ | 一个中心区空格变为加速带 | — |
| **次元裂隙** | 🌀 | 随机出现一对新传送阵 | 需要至少 2 个空普通格 |
| **寒冰风暴** | ❄️ | 一个空格及其最多 2 个相邻格变为冰面 | 最多影响 3 格 |
| **生命之泉** | 💚 | 所有棋子恢复 1 点 HP | **仅生存模式**可触发 |
| **地震** | 🌋 | 随机清除最多 2 个障碍物（恢复为普通） | — |

> **地形洗牌**：每次触发随机事件时，棋盘上所有特殊地形（传送阵、障碍物、加速带、冰面、塌陷区）会被随机重新分配到新的中心区空位上。传送阵的配对关系会保留，但位置会改变。这使每次事件发生后棋盘地形格局焕然一新，增加战术变数。

### AI 系统

三种难度级别，在各游戏模式下有针对性的评估策略：

| 难度 | 选择方式 | 说明 |
|------|---------|------|
| **简单** | 完全随机 | 从所有合法移动中随机选择 |
| **中等** | 贪心 + 随机 | 评估所有移动得分，从前 3 名中随机选 |
| **困难** | 深度评估 | 考虑位置优势、机动性、包围风险，始终选最优 |

**模式策略差异**：
- **经典模式**：优先缩短到目标区域中心的距离，鼓励离开母区，到达目标区大幅加分
- **积分模式**：高价值资源格优先，离开资源格有代价，靠近其他资源格加分
- **生存模式**：
  - 刺客主动进攻，优先攻击低 HP 目标
  - 低 HP 棋子远离威胁区域
  - 盾牌倾向保护队友（靠近友方棋子）
- **通用加分**：跳跃距离远、踩到加速带、传送阵；减分：冰面、塌陷区

**AI 法师决策**：困难 AI 会在敌方棋子 3 格范围内的普通地砖上放置障碍物（50% 概率触发）。

### 自动清理机制
- **Durable Object alarm**：游戏结束 10 分钟后、所有玩家断连 30 分钟后、空闲房间 2 小时未开始后自动清理房间存储
- **Cron Trigger**：每天凌晨 3 点自动清理 D1 中 90 天前的对局记录和 180 天未活跃的空玩家
- **KV TTL**：匹配队列 2 分钟过期、活跃房间列表 1 小时过期、玩家会话 30 天过期

### 数据存储

#### D1 数据库

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `players` | 玩家信息 | id, name, rating(初始1000), games_played, games_won, last_seen |
| `games` | 对局记录 | id, mode, status, player_count, winner_id, duration_seconds, finished_at |
| `game_players` | 对局-玩家关联 | game_id, player_id, player_index, is_ai, score, result(win/lose) |
| `game_moves` | 对局走子记录 | game_id, turn, player_index, piece_id, from_cell, to_cell |

**Rating 机制**：胜利 +25 分，失败 -15 分，最低 0 分。

#### KV 存储

| Key 格式 | 用途 | TTL |
|----------|------|-----|
| `player:{id}` | 玩家会话缓存 | 30 天 |
| `queue:{mode}:{count}` | 匹配队列 | 120 秒 |
| `rooms:active` | 活跃房间列表（最多 50 条） | 1 小时 |

#### Durable Object 存储

每个 `GameRoom` DO 实例的 SQLite 中存储一个 `gameState` 对象，包含完整的棋盘、棋子、玩家、配置、事件历史等。通过 `alarm()` 定时器在过期后执行 `storage.deleteAll()` 清理。

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
