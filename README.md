# 星陨跳棋 - 改版策略对战游戏

基于 **Cloudflare** 全栈方案（Workers + Durable Objects + D1 + KV + R2）的改版跳棋在线对战游戏。

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

## 🏗 技术架构

```
┌─────────────────────────────────────────┐
│                 前端                      │
│  HTML Canvas 渲染 + WebSocket 客户端      │
│          (Cloudflare Pages/Assets)       │
├─────────────────────────────────────────┤
│           Cloudflare Worker              │
│  HTTP API + 路由 + CORS + 鉴权           │
├────────┬────────────┬───────────────────┤
│   D1   │     KV     │  Durable Objects  │
│ 玩家   │  会话管理    │  游戏房间          │
│ 排行榜  │  匹配队列   │  WebSocket管理     │
│ 游戏记录│  活跃房间   │  实时游戏逻辑       │
├────────┴────────────┴───────────────────┤
│          R2 对象存储                      │
│     游戏回放/地图数据/静态资源              │
└─────────────────────────────────────────┘
```

## 📦 部署指南

本项目支持两种部署方式：**Cloudflare 网页控制台部署**（推荐，无需命令行）和 **Wrangler CLI 部署**。

---

### 方式一：Cloudflare 网页控制台部署（推荐）

> 适用于已有构建产物 `_worker.js` 的情况（GitHub Action 会自动构建并提交到仓库根目录）。

#### 第 1 步：创建 D1 数据库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧导航栏点击 **Workers 和 Pages** → **D1 SQL 数据库**
3. 点击 **创建数据库**，名称填 `chinese-checkers-db`，点击创建
4. 进入刚创建的数据库，点击 **控制台** 标签页
5. 将 `schema.sql` 中的全部 SQL 粘贴到控制台输入框中，点击 **Execute** 执行
6. 记下数据库详情页顶部的 **数据库 ID**（后续绑定用）

#### 第 2 步：创建 KV 命名空间

1. 左侧导航栏点击 **Workers 和 Pages** → **KV**
2. 点击 **创建命名空间**，名称填 `SESSIONS`，点击添加
3. 记下创建后显示的 **命名空间 ID**

#### 第 3 步：创建 R2 存储桶

1. 左侧导航栏点击 **R2 对象存储**
2. 点击 **创建存储桶**，名称填 `chinese-checkers-storage`，点击创建

#### 第 4 步：创建 Pages 项目并上传文件

1. 左侧导航栏点击 **Workers 和 Pages** → **概述**
2. 点击 **创建** → 选择 **Pages** → **上传资产**
3. 项目名称填 `chinese-checkers-online`，点击 **创建项目**
4. **上传文件**：将 `public/` 文件夹中的所有文件 **和** 仓库根目录的 `_worker.js` 一起拖入上传区

   上传时的文件结构应为（扁平放到一起）：
   ```
   _worker.js          ← 仓库根目录的构建产物
   index.html          ← public/ 下的文件
   style.css
   js/
     main.js
     game.js
     renderer.js
     network.js
   ```

5. 点击 **部署站点**，等待部署完成

#### 第 5 步：配置资源绑定

1. 进入刚创建的 Pages 项目 → **设置** → **Functions**
2. 向下滚动到 **绑定** 区域，依次添加以下绑定：

   | 绑定类型 | 变量名称 | 绑定目标 |
   |---------|---------|---------|
   | **D1 数据库** | `DB` | 选择 `chinese-checkers-db` |
   | **KV 命名空间** | `SESSIONS` | 选择 `SESSIONS` |
   | **R2 存储桶** | `STORAGE` | 选择 `chinese-checkers-storage` |
   | **Durable Object** | `GAME_ROOM` | 类名填 `GameRoom` |

3. 兼容性设置（同页面上方）：
   - **兼容日期** 设为 `2024-09-23` 或更新
   - **兼容标志** 添加 `nodejs_compat`

4. 点击 **保存**

#### 第 6 步：重新部署使绑定生效

1. 回到项目的 **部署** 标签页
2. 找到最新的部署，点击右侧 **...** → **重试部署**
3. 等待部署完成后，访问分配的 `*.pages.dev` 域名即可开始游戏 🎉

#### 后续更新

每次代码推送到 GitHub `main` 分支后：
1. GitHub Action 会自动构建并更新 `_worker.js`
2. 回到 Cloudflare Pages 项目 → **部署** → **上传资产**
3. 重新上传更新后的 `_worker.js` 和 `public/` 中有变动的文件即可

> 💡 **更方便的做法**：在 Pages 项目设置中连接 GitHub 仓库，实现推送后自动部署。
> 进入项目 **设置** → **构建和部署** → **连接 Git**，选择仓库后设置：
> - 构建命令：`npm run build`
> - 构建输出目录：`public`（然后手动保证 `_worker.js` 存在于 `public/` 中，或设置自定义构建命令 `npm install && npm run build && cp _worker.js public/`）

---

### 方式二：Wrangler CLI 部署

#### 前提条件
- Node.js 18+
- Cloudflare 账号
- Wrangler CLI

#### 1. 安装依赖

```bash
cd Chinese-Checkers
npm install
```

#### 2. 登录 Cloudflare

```bash
npx wrangler login
```

#### 3. 创建 D1 数据库

```bash
npx wrangler d1 create chinese-checkers-db
```

将返回的 `database_id` 填入 `wrangler.toml` 中 `[[d1_databases]]` 的 `database_id`。

#### 4. 创建 KV 命名空间

```bash
npx wrangler kv namespace create SESSIONS
```

将返回的 `id` 填入 `wrangler.toml` 中 `[[kv_namespaces]]` 的 `id`。

#### 5. 创建 R2 存储桶

```bash
npx wrangler r2 bucket create chinese-checkers-storage
```

#### 6. 初始化数据库

```bash
# 本地开发
npm run db:init:local

# 远程
npm run db:init
```

#### 7. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787` 即可开始游戏。

#### 8. 部署到 Cloudflare

```bash
npm run deploy
```

## 🎯 项目结构

```
Chinese-Checkers/
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 项目配置
├── schema.sql             # D1 数据库结构
├── src/
│   ├── index.js           # Worker 主入口 (API路由)
│   ├── game-room.js       # Durable Object (游戏房间)
│   └── game/
│       ├── board.js       # 六角星棋盘 & 坐标系统
│       ├── pieces.js      # 棋子类型 & 能力系统
│       ├── terrain.js     # 动态地形系统
│       ├── rules.js       # 移动规则 & 验证引擎
│       ├── ai.js          # AI 对手逻辑
│       ├── events.js      # 随机事件系统
│       └── modes.js       # 游戏模式 & 胜利条件
└── public/
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
| GET | `/api/rooms` | 房间列表 |
| POST | `/api/matchmaking` | 快速匹配 |
| GET | `/api/leaderboard` | 排行榜 |
| GET | `/api/history/:playerId` | 游戏历史 |
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
- `gameStarted` - 游戏开始
- `moved` - 棋子移动
- `turnChanged` - 回合切换
- `randomEvent` - 随机事件触发
- `gameOver` - 游戏结束
