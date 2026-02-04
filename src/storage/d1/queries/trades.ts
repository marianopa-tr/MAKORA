import { generateId, nowISO } from "../../../lib/utils";
import type { D1Client, TradeRow } from "../client";

export interface CreateTradeParams {
  approval_id?: string;
  broker_order_id: string;
  symbol: string;
  side: string;
  qty?: number;
  notional?: number;
  order_type: string;
  limit_price?: number;
  stop_price?: number;
  status: string;
}

export async function createTrade(db: D1Client, params: CreateTradeParams): Promise<string> {
  const id = generateId();
  const now = nowISO();

  await db.run(
    `INSERT INTO trades (id, approval_id, broker_order_id, symbol, side, qty, order_type, limit_price, stop_price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.approval_id ?? null,
      params.broker_order_id,
      params.symbol,
      params.side,
      params.qty ?? params.notional ?? 0,
      params.order_type,
      params.limit_price ?? null,
      params.stop_price ?? null,
      params.status,
      now,
      now,
    ]
  );

  return id;
}

export async function updateTradeStatus(
  db: D1Client,
  tradeId: string,
  status: string,
  filledQty?: number,
  filledAvgPrice?: number
): Promise<void> {
  await db.run(
    `UPDATE trades SET status = ?, filled_qty = COALESCE(?, filled_qty), filled_avg_price = COALESCE(?, filled_avg_price), updated_at = ? WHERE id = ?`,
    [status, filledQty ?? null, filledAvgPrice ?? null, nowISO(), tradeId]
  );
}

export async function getTradeByBrokerOrderId(db: D1Client, brokerOrderId: string): Promise<TradeRow | null> {
  return db.executeOne<TradeRow>(`SELECT * FROM trades WHERE broker_order_id = ?`, [brokerOrderId]);
}

export async function getTradeById(db: D1Client, tradeId: string): Promise<TradeRow | null> {
  return db.executeOne<TradeRow>(`SELECT * FROM trades WHERE id = ?`, [tradeId]);
}

export async function getRecentTrades(
  db: D1Client,
  params: {
    symbol?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<TradeRow[]> {
  const { symbol, limit = 50, offset = 0 } = params;

  if (symbol) {
    return db.execute<TradeRow>(`SELECT * FROM trades WHERE symbol = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
      symbol,
      limit,
      offset,
    ]);
  }

  return db.execute<TradeRow>(`SELECT * FROM trades ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

export async function getTradesToday(db: D1Client): Promise<TradeRow[]> {
  const today = new Date().toISOString().split("T")[0];
  return db.execute<TradeRow>(`SELECT * FROM trades WHERE created_at >= ? ORDER BY created_at DESC`, [today]);
}
