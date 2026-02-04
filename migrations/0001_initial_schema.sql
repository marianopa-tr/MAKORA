CREATE TABLE tool_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  latency_ms INTEGER,
  provider_calls INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tool_logs_tool_name ON tool_logs(tool_name);
CREATE INDEX idx_tool_logs_created_at ON tool_logs(created_at);
CREATE INDEX idx_tool_logs_request_id ON tool_logs(request_id);

CREATE TABLE order_approvals (
  id TEXT PRIMARY KEY,
  preview_hash TEXT NOT NULL,
  order_params_json TEXT NOT NULL,
  policy_result_json TEXT NOT NULL,
  approval_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_order_approvals_token ON order_approvals(approval_token);
CREATE INDEX idx_order_approvals_expires ON order_approvals(expires_at);

CREATE TABLE trades (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  approval_id TEXT REFERENCES order_approvals(id),
  broker_order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  order_type TEXT NOT NULL,
  limit_price REAL,
  stop_price REAL,
  status TEXT NOT NULL,
  filled_qty REAL,
  filled_avg_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_created_at ON trades(created_at);
CREATE INDEX idx_trades_broker_order_id ON trades(broker_order_id);

CREATE TABLE risk_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kill_switch_active INTEGER NOT NULL DEFAULT 0,
  kill_switch_reason TEXT,
  kill_switch_at TEXT,
  daily_loss_usd REAL NOT NULL DEFAULT 0,
  daily_loss_reset_at TEXT,
  last_loss_at TEXT,
  cooldown_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO risk_state (id, daily_loss_reset_at) VALUES (1, datetime('now'));

CREATE TABLE policy_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
