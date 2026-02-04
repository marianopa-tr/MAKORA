-- Rename Alpaca-specific order ID to broker-agnostic field
ALTER TABLE trades RENAME COLUMN alpaca_order_id TO broker_order_id;

DROP INDEX IF EXISTS idx_trades_alpaca_order_id;
CREATE INDEX IF NOT EXISTS idx_trades_broker_order_id ON trades(broker_order_id);
