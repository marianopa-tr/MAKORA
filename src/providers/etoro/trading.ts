import { createError, ErrorCode } from "../../lib/errors";
import type {
  Account,
  Asset,
  BrokerProvider,
  ListOrdersParams,
  MarketClock,
  MarketDay,
  Order,
  OrderStatus,
  OrderParams,
  PortfolioHistory,
  PortfolioHistoryParams,
  Position,
} from "../types";
import type { EtoroClient } from "./client";
import type { EtoroInstrumentCache } from "./instruments";

interface EtoroRate {
  instrumentId?: number;
  instrumentID?: number;
  ask?: number;
  bid?: number;
  lastExecution?: number;
  date?: string;
}

interface EtoroRatesResponse {
  rates?: EtoroRate[];
}

interface EtoroPortfolioPosition {
  positionId?: number;
  positionID?: number;
  PositionID?: number;
  instrumentId?: number;
  instrumentID?: number;
  InstrumentID?: number;
  isBuy?: boolean;
  openDateTime?: string;
  openRate?: number;
  closeRate?: number;
  amount?: number;
  units?: number;
  pnL?: number;
  pnl?: number;
  PnL?: number;
  unrealizedPnL?: number;
  leverage?: number;
}

interface EtoroPortfolioOrder {
  orderId?: number;
  orderID?: number;
  instrumentId?: number;
  instrumentID?: number;
  isBuy?: boolean;
  openDateTime?: string;
  lastUpdate?: string;
  amount?: number;
  amountInUnits?: number;
  units?: number;
  leverage?: number;
  statusId?: number;
  statusID?: number;
}

interface EtoroPortfolioResponse {
  clientPortfolio?: {
    credit?: number;
    unrealizedPnL?: number;
    positions?: EtoroPortfolioPosition[];
    mirrors?: EtoroMirror[];
    orders?: EtoroPortfolioOrder[];
    ordersForOpen?: EtoroPortfolioOrder[];
    ordersForClose?: EtoroPortfolioOrder[];
  };
}

interface EtoroMirror {
  mirrorId?: number;
  mirrorID?: number;
  positions?: EtoroPortfolioPosition[];
}

interface EtoroOrderOpenResponse {
  orderForOpen?: {
    orderID?: number;
    statusID?: number;
    instrumentID?: number;
    isBuy?: boolean;
    amountInUnits?: number;
    amount?: number;
    openDateTime?: string;
    lastUpdate?: string;
  };
}

interface EtoroOrderDetailsResponse {
  orderId?: number;
  instrumentId?: number;
  isBuy?: boolean;
  amount?: number;
  units?: number;
  statusId?: number;
  openDateTime?: string;
  lastUpdate?: string;
}

interface EtoroInstrumentDisplay {
  instrumentId?: number;
  instrumentID?: number;
  instrumentDisplayName?: string;
  exchangeId?: number;
  symbolFull?: string;
}

interface EtoroInstrumentMetadataResponse {
  instrumentDisplayDatas?: EtoroInstrumentDisplay[];
}

export class EtoroTradingProvider implements BrokerProvider {
  constructor(private client: EtoroClient, private instruments: EtoroInstrumentCache) {}

  async getAccount(): Promise<Account> {
    const env = this.client.getEnvironment();
    let credit = 0;
    let equity = 0;
    let longMarketValue = 0;

    try {
      const response = await this.client.tradingRequest<EtoroPortfolioResponse>(
        "GET",
        `/trading/info/${env}/portfolio`
      );
      credit = response.clientPortfolio?.credit ?? 0;
      const rawPositions = this.collectPositions(response);
      const instrumentIds = rawPositions
        .map((pos) => this.getInstrumentId(pos))
        .filter((id): id is number => typeof id === "number");

      let meta = new Map<number, { symbol: string; instrumentTypeId?: number; exchangeId?: number }>();
      try {
        meta = await this.instruments.resolveMetadata(instrumentIds);
      } catch {
        meta = new Map();
      }

      let rates = new Map<number, EtoroRate>();
      try {
        rates = await this.fetchRates(instrumentIds);
      } catch {
        rates = new Map();
      }

      const positions = rawPositions.map((pos) => {
        const instrumentId = this.getInstrumentId(pos);
        const metaEntry = instrumentId ? meta.get(instrumentId) : undefined;
        const rate = instrumentId ? rates.get(instrumentId) : undefined;
        return this.parsePosition(pos, metaEntry, rate);
      });

      longMarketValue = positions.reduce((sum, pos) => sum + (pos.market_value ?? 0), 0);
      equity = credit + longMarketValue;
    } catch {
      const response = await this.client.tradingRequest<EtoroPortfolioResponse>(
        "GET",
        `/trading/info/${env}/pnl`
      );
      credit = response.clientPortfolio?.credit ?? 0;
      const unrealizedPnL = response.clientPortfolio?.unrealizedPnL ?? 0;
      equity = credit + unrealizedPnL;
      longMarketValue = Math.max(equity - credit, 0);
    }

    return {
      id: `etoro-${env}`,
      account_number: `etoro-${env}`,
      status: "ACTIVE",
      currency: "USD",
      cash: credit,
      buying_power: credit,
      regt_buying_power: credit,
      daytrading_buying_power: credit,
      equity,
      last_equity: equity,
      long_market_value: longMarketValue,
      short_market_value: 0,
      portfolio_value: equity,
      pattern_day_trader: false,
      trading_blocked: false,
      transfers_blocked: false,
      account_blocked: false,
      multiplier: "1",
      shorting_enabled: false,
      maintenance_margin: 0,
      initial_margin: 0,
      daytrade_count: 0,
      created_at: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const env = this.client.getEnvironment();
    const response = await this.client.tradingRequest<EtoroPortfolioResponse>(
      "GET",
      `/trading/info/${env}/portfolio`
    );
    const rawPositions = response.clientPortfolio?.positions ?? [];
    const instrumentIds = rawPositions
      .map((pos) => this.getInstrumentId(pos))
      .filter((id): id is number => typeof id === "number");

    let meta = new Map<number, { symbol: string; instrumentTypeId?: number; exchangeId?: number }>();
    try {
      meta = await this.instruments.resolveMetadata(instrumentIds);
    } catch {
      meta = new Map();
    }

    let rates = new Map<number, EtoroRate>();
    try {
      rates = await this.fetchRates(instrumentIds);
    } catch {
      rates = new Map();
    }

    return rawPositions.map((pos) => {
      const instrumentId = this.getInstrumentId(pos);
      const metaEntry = instrumentId ? meta.get(instrumentId) : undefined;
      const rate = instrumentId ? rates.get(instrumentId) : undefined;
      return this.parsePosition(pos, metaEntry, rate);
    });
  }

  async getPosition(symbol: string): Promise<Position | null> {
    const positions = await this.getPositions();
    const found = positions.find((pos) => pos.symbol.toUpperCase() === symbol.toUpperCase());
    return found ?? null;
  }

  async closePosition(symbol: string, qty?: number, percentage?: number): Promise<Order> {
    const env = this.client.getEnvironment();
    const response = await this.client.tradingRequest<EtoroPortfolioResponse>(
      "GET",
      `/trading/info/${env}/portfolio`
    );
    const rawPositions = response.clientPortfolio?.positions ?? [];
    const instrumentIds = rawPositions
      .map((pos) => this.getInstrumentId(pos))
      .filter((id): id is number => typeof id === "number");

    let meta = new Map<number, { symbol: string; instrumentTypeId?: number; exchangeId?: number }>();
    try {
      meta = await this.instruments.resolveMetadata(instrumentIds);
    } catch {
      meta = new Map();
    }

    let targetInstrumentId: number | null = null;
    try {
      targetInstrumentId = await this.instruments.resolveInstrumentId(symbol);
    } catch {
      targetInstrumentId = null;
    }

    const position = rawPositions.find((pos) => {
      const instrumentId = this.getInstrumentId(pos);
      if (targetInstrumentId && instrumentId === targetInstrumentId) {
        return true;
      }
      const metaSymbol = instrumentId ? meta.get(instrumentId)?.symbol ?? String(instrumentId) : "UNKNOWN";
      return metaSymbol.toUpperCase() === symbol.toUpperCase();
    });

    if (!position) {
      throw createError(ErrorCode.NOT_FOUND, `No open position for ${symbol}`);
    }

    const totalUnits = position.units ?? 0;
    let unitsToDeduct: number | null = null;
    if (qty !== undefined) {
      unitsToDeduct = Math.min(qty, totalUnits);
    } else if (percentage !== undefined) {
      unitsToDeduct = Math.max(Math.min((percentage / 100) * totalUnits, totalUnits), 0);
    }

    const positionId = this.getPositionId(position);
    if (!positionId) {
      throw createError(ErrorCode.NOT_FOUND, `No position ID found for ${symbol}`);
    }

    const closeResponse = await this.client.tradingRequest<Record<string, unknown>>(
      "POST",
      `/trading/execution/${env}/market-close-orders/positions/${positionId}`,
      {
        body: {
          UnitsToDeduct: unitsToDeduct ?? null,
        },
      }
    );

    const instrumentId = this.getInstrumentId(position) ?? 0;
    const side = position.isBuy === false ? "buy" : "sell";
    return this.mapGenericOrder(symbol, instrumentId, side, closeResponse);
  }

  async createOrder(params: OrderParams): Promise<Order> {
    if (params.type !== "market") {
      throw createError(ErrorCode.NOT_SUPPORTED, `eToro only supports market orders right now`);
    }

    const env = this.client.getEnvironment();
    const instrumentId = await this.instruments.resolveInstrumentId(params.symbol);
    const units = await this.resolveUnits(instrumentId, params);

    const response = await this.client.tradingRequest<EtoroOrderOpenResponse>(
      "POST",
      `/trading/execution/${env}/market-open-orders/by-units`,
      {
        body: {
          InstrumentID: instrumentId,
          IsBuy: params.side === "buy",
          Leverage: 1,
          AmountInUnits: units,
          StopLossRate: null,
          TakeProfitRate: null,
          IsTslEnabled: false,
          IsNoStopLoss: true,
          IsNoTakeProfit: true,
        },
      }
    );

    return this.mapOpenOrder(params, instrumentId, response);
  }

  async getOrder(orderId: string): Promise<Order> {
    const env = this.client.getEnvironment();
    const response = await this.client.tradingRequest<EtoroOrderDetailsResponse>(
      "GET",
      `/trading/info/${env}/orders/${encodeURIComponent(orderId)}`
    );
    const instrumentId = response.instrumentId ?? 0;
    const symbol = instrumentId ? await this.instruments.resolveSymbol(instrumentId) : orderId;

    return {
      id: String(response.orderId ?? orderId),
      client_order_id: String(response.orderId ?? orderId),
      symbol,
      asset_id: String(instrumentId || ""),
      asset_class: this.mapAssetClass(symbol),
      qty: String(response.units ?? response.amount ?? 0),
      filled_qty: "0",
      filled_avg_price: null,
      order_class: "simple",
      order_type: "market",
      type: "market",
      side: response.isBuy === false ? "sell" : "buy",
      time_in_force: "day",
      limit_price: null,
      stop_price: null,
      status: this.mapStatus(response.statusId),
      extended_hours: false,
      created_at: response.openDateTime ?? new Date().toISOString(),
      updated_at: response.lastUpdate ?? response.openDateTime ?? new Date().toISOString(),
      submitted_at: response.openDateTime ?? new Date().toISOString(),
      filled_at: null,
      expired_at: null,
      canceled_at: null,
      failed_at: null,
    };
  }

  async listOrders(_params?: ListOrdersParams): Promise<Order[]> {
    const env = this.client.getEnvironment();
    const response = await this.client.tradingRequest<EtoroPortfolioResponse>(
      "GET",
      `/trading/info/${env}/portfolio`
    );
    const orders = [
      ...(response.clientPortfolio?.orders ?? []),
      ...(response.clientPortfolio?.ordersForOpen ?? []),
      ...(response.clientPortfolio?.ordersForClose ?? []),
    ];

    const instrumentIds = orders
      .map((order) => this.getInstrumentId(order))
      .filter((id): id is number => typeof id === "number");
    let meta = new Map<number, { symbol: string; instrumentTypeId?: number; exchangeId?: number }>();
    try {
      meta = await this.instruments.resolveMetadata(instrumentIds);
    } catch {
      meta = new Map();
    }

    return orders.map((order) => {
      const instrumentId = this.getInstrumentId(order);
      const symbol = instrumentId ? meta.get(instrumentId)?.symbol ?? String(instrumentId) : "UNKNOWN";
      const orderId = order.orderId ?? order.orderID ?? Date.now();
      return {
        id: String(orderId),
        client_order_id: String(orderId),
        symbol,
        asset_id: String(instrumentId ?? ""),
        asset_class: this.mapAssetClass(symbol),
        qty: String(order.amountInUnits ?? order.units ?? order.amount ?? 0),
        filled_qty: "0",
        filled_avg_price: null,
        order_class: "simple",
        order_type: "market",
        type: "market",
        side: order.isBuy === false ? "sell" : "buy",
        time_in_force: "day",
        limit_price: null,
        stop_price: null,
        status: this.mapStatus(order.statusId ?? order.statusID),
        extended_hours: false,
        created_at: order.openDateTime ?? new Date().toISOString(),
        updated_at: order.lastUpdate ?? order.openDateTime ?? new Date().toISOString(),
        submitted_at: order.openDateTime ?? new Date().toISOString(),
        filled_at: null,
        expired_at: null,
        canceled_at: null,
        failed_at: null,
      };
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    const env = this.client.getEnvironment();
    try {
      await this.client.tradingRequest<void>("DELETE", `/trading/execution/${env}/market-open-orders/${orderId}`);
      return;
    } catch (_error) {
      await this.client.tradingRequest<void>("DELETE", `/trading/execution/${env}/market-close-orders/${orderId}`);
    }
  }

  async cancelAllOrders(): Promise<void> {
    const orders = await this.listOrders();
    for (const order of orders) {
      await this.cancelOrder(order.id);
    }
  }

  async getClock(): Promise<MarketClock> {
    const now = new Date().toISOString();
    return {
      timestamp: now,
      is_open: true,
      next_open: now,
      next_close: now,
    };
  }

  async getCalendar(_start: string, _end: string): Promise<MarketDay[]> {
    return [];
  }

  async getAsset(symbol: string): Promise<Asset | null> {
    try {
      const instrumentId = await this.instruments.resolveInstrumentId(symbol);
      const meta = await this.client.marketDataRequest<EtoroInstrumentMetadataResponse>(
        "GET",
        "/market-data/instruments",
        { instrumentIds: [instrumentId] }
      );
      const display = meta.instrumentDisplayDatas?.[0];

      return {
        id: String(display?.instrumentId ?? display?.instrumentID ?? instrumentId),
        class: this.mapAssetClass(display?.symbolFull ?? symbol),
        exchange: String(display?.exchangeId ?? "ETORO"),
        symbol: (display?.symbolFull ?? symbol).toUpperCase(),
        name: display?.instrumentDisplayName ?? symbol.toUpperCase(),
        status: "active",
        tradable: true,
        marginable: false,
        shortable: false,
        fractionable: true,
      };
    } catch (error) {
      if ((error as { code?: string }).code === ErrorCode.NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  async getPortfolioHistory(_params?: PortfolioHistoryParams): Promise<PortfolioHistory> {
    return {
      timestamp: [],
      equity: [],
      profit_loss: [],
      profit_loss_pct: [],
      base_value: 0,
      timeframe: "1D",
    };
  }

  private async resolveUnits(instrumentId: number, params: OrderParams): Promise<number> {
    if (params.qty !== undefined) {
      return params.qty;
    }
    if (params.notional === undefined) {
      throw createError(ErrorCode.INVALID_INPUT, "Order must include qty or notional");
    }

    const rates = await this.client.marketDataRequest<EtoroRatesResponse>(
      "GET",
      "/market-data/instruments/rates",
      { instrumentIds: [instrumentId] }
    );
    const rate = rates.rates?.[0];
    const price = params.side === "buy" ? rate?.ask ?? rate?.lastExecution : rate?.bid ?? rate?.lastExecution;
    if (!price || price <= 0) {
      throw createError(ErrorCode.PROVIDER_ERROR, "Unable to compute units for order (missing price)");
    }

    return params.notional / price;
  }

  private parsePosition(
    position: EtoroPortfolioPosition,
    meta?: { symbol: string; instrumentTypeId?: number; exchangeId?: number },
    rate?: EtoroRate
  ): Position {
    const instrumentId = this.getInstrumentId(position);
    const symbol = meta?.symbol ?? (instrumentId ? String(instrumentId) : "UNKNOWN");
    const qty = position.units ?? 0;
    const openRate = position.openRate ?? 0;
    const rateCandidate = rate?.lastExecution ?? rate?.bid ?? rate?.ask ?? null;
    const ratePrice = rateCandidate && rateCandidate > 0 ? rateCandidate : null;
    const currentPrice = position.closeRate ?? ratePrice ?? openRate;
    const marketValue = currentPrice * qty;
    const costBasis = position.amount ?? (openRate * qty);
    const side = position.isBuy === false ? "short" : "long";
    const rawPnL = position.pnL ?? position.pnl ?? position.PnL ?? position.unrealizedPnL ?? null;
    const computedPnL = (currentPrice - openRate) * qty * (side === "short" ? -1 : 1);
    const pnl = rawPnL ?? computedPnL;

    return {
      asset_id: String(instrumentId ?? ""),
      symbol,
      exchange: String(meta?.exchangeId ?? "ETORO"),
      asset_class: this.mapAssetClass(symbol),
      avg_entry_price: openRate,
      qty,
      side,
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_pl: pnl,
      unrealized_plpc: costBasis ? pnl / costBasis : 0,
      unrealized_intraday_pl: 0,
      unrealized_intraday_plpc: 0,
      current_price: currentPrice,
      lastday_price: 0,
      change_today: 0,
    };
  }

  private getInstrumentId(record: EtoroPortfolioPosition | EtoroPortfolioOrder): number | null {
    return (
      record.instrumentId ??
      record.instrumentID ??
      (record as { InstrumentID?: number }).InstrumentID ??
      null
    );
  }

  private getPositionId(position: EtoroPortfolioPosition): number | null {
    return position.positionId ?? position.positionID ?? position.PositionID ?? null;
  }

  private collectPositions(response: EtoroPortfolioResponse): EtoroPortfolioPosition[] {
    const positions = [...(response.clientPortfolio?.positions ?? [])];
    const mirrors = response.clientPortfolio?.mirrors ?? [];
    for (const mirror of mirrors) {
      if (mirror.positions?.length) {
        positions.push(...mirror.positions);
      }
    }

    const seen = new Set<number>();
    return positions.filter((pos) => {
      const id = this.getPositionId(pos);
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  private async fetchRates(instrumentIds: number[]): Promise<Map<number, EtoroRate>> {
    if (instrumentIds.length === 0) {
      return new Map();
    }

    const rateMap = new Map<number, EtoroRate>();

    for (let i = 0; i < instrumentIds.length; i += 100) {
      const chunk = instrumentIds.slice(i, i + 100);
      try {
        const response = await this.client.marketDataRequest<EtoroRatesResponse>(
          "GET",
          "/market-data/instruments/rates",
          { instrumentIds: chunk }
        );

        for (const rate of response.rates ?? []) {
          const id = rate.instrumentId ?? rate.instrumentID;
          if (typeof id === "number") {
            rateMap.set(id, rate);
          }
        }

        const missingIds = chunk.filter((id) => !rateMap.has(id));
        for (const id of missingIds.slice(0, 25)) {
          try {
            const singleResponse = await this.client.marketDataRequest<EtoroRatesResponse>(
              "GET",
              "/market-data/instruments/rates",
              { instrumentIds: [id] }
            );
            for (const rate of singleResponse.rates ?? []) {
              const parsedId = rate.instrumentId ?? rate.instrumentID;
              if (typeof parsedId === "number") {
                rateMap.set(parsedId, rate);
              }
            }
          } catch {
            // ignore single-id failures
          }
        }
      } catch {
        for (const id of chunk.slice(0, 25)) {
          try {
            const singleResponse = await this.client.marketDataRequest<EtoroRatesResponse>(
              "GET",
              "/market-data/instruments/rates",
              { instrumentIds: [id] }
            );
            for (const rate of singleResponse.rates ?? []) {
              const parsedId = rate.instrumentId ?? rate.instrumentID;
              if (typeof parsedId === "number") {
                rateMap.set(parsedId, rate);
              }
            }
          } catch {
            // ignore single-id failures
          }
        }
      }
    }
    return rateMap;
  }

  private mapOpenOrder(params: OrderParams, instrumentId: number, response: EtoroOrderOpenResponse): Order {
    const order = response.orderForOpen ?? {};
    const orderId = order.orderID ?? 0;
    const symbol = params.symbol.toUpperCase();

    return {
      id: String(orderId || `open-${Date.now()}`),
      client_order_id: String(orderId || `open-${Date.now()}`),
      symbol,
      asset_id: String(order.instrumentID ?? instrumentId),
      asset_class: this.mapAssetClass(symbol),
      qty: String(order.amountInUnits ?? params.qty ?? 0),
      filled_qty: "0",
      filled_avg_price: null,
      order_class: "simple",
      order_type: params.type,
      type: params.type,
      side: params.side,
      time_in_force: params.time_in_force,
      limit_price: params.limit_price === undefined ? null : String(params.limit_price),
      stop_price: params.stop_price === undefined ? null : String(params.stop_price),
      status: this.mapStatus(order.statusID),
      extended_hours: false,
      created_at: order.openDateTime ?? new Date().toISOString(),
      updated_at: order.lastUpdate ?? order.openDateTime ?? new Date().toISOString(),
      submitted_at: order.openDateTime ?? new Date().toISOString(),
      filled_at: null,
      expired_at: null,
      canceled_at: null,
      failed_at: null,
    };
  }

  private mapGenericOrder(
    symbol: string,
    instrumentId: number,
    side: "buy" | "sell",
    response: Record<string, unknown>
  ): Order {
    const orderId =
      (response.orderId as number | undefined) ??
      (response.orderID as number | undefined) ??
      (response.id as number | undefined) ??
      Date.now();

    return {
      id: String(orderId),
      client_order_id: String(orderId),
      symbol: symbol.toUpperCase(),
      asset_id: String(instrumentId),
      asset_class: this.mapAssetClass(symbol),
      qty: "0",
      filled_qty: "0",
      filled_avg_price: null,
      order_class: "simple",
      order_type: "market",
      type: "market",
      side,
      time_in_force: "day",
      limit_price: null,
      stop_price: null,
      status: "accepted",
      extended_hours: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      filled_at: null,
      expired_at: null,
      canceled_at: null,
      failed_at: null,
    };
  }

  private mapStatus(statusId?: number): OrderStatus {
    if (statusId === undefined || statusId === null) return "new";
    if (statusId === 1) return "accepted";
    if (statusId === 2) return "filled";
    if (statusId === 3) return "canceled";
    return "new";
  }

  private mapAssetClass(symbol: string): "us_equity" | "crypto" {
    if (symbol.includes("/") || symbol.toUpperCase().endsWith("USD")) {
      return "crypto";
    }
    return "us_equity";
  }
}

export function createEtoroTradingProvider(client: EtoroClient, instruments: EtoroInstrumentCache): EtoroTradingProvider {
  return new EtoroTradingProvider(client, instruments);
}
