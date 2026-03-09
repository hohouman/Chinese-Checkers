-- D1 数据库 Schema
-- 玩家表
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT 'default',
  rating INTEGER DEFAULT 1000,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now'))
);

-- 游戏记录表
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'classic',
  status TEXT NOT NULL DEFAULT 'waiting',
  player_count INTEGER NOT NULL DEFAULT 2,
  winner_id TEXT,
  config TEXT, -- JSON 游戏配置
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_seconds INTEGER
);

-- 游戏参与者表
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_index INTEGER NOT NULL,
  is_ai INTEGER DEFAULT 0,
  ai_level TEXT,
  score INTEGER DEFAULT 0,
  result TEXT, -- 'win', 'lose', 'draw'
  PRIMARY KEY (game_id, player_id),
  FOREIGN KEY (game_id) REFERENCES games(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- 游戏回合记录表
CREATE TABLE IF NOT EXISTS game_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  player_index INTEGER NOT NULL,
  move_type TEXT NOT NULL, -- 'move', 'ability', 'event'
  move_data TEXT NOT NULL, -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id)
);

-- 排行榜视图
CREATE VIEW IF NOT EXISTS leaderboard AS
SELECT
  p.id,
  p.name,
  p.rating,
  p.games_played,
  p.games_won,
  CASE WHEN p.games_played > 0
    THEN ROUND(CAST(p.games_won AS REAL) / p.games_played * 100, 1)
    ELSE 0
  END AS win_rate
FROM players p
WHERE p.games_played >= 3
ORDER BY p.rating DESC
LIMIT 100;

-- 索引
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_mode ON games(mode);
CREATE INDEX IF NOT EXISTS idx_game_players_player ON game_players(player_id);
CREATE INDEX IF NOT EXISTS idx_game_moves_game ON game_moves(game_id);
