import type { Bar, BarsParams, MarketDataProvider, Quote, Snapshot } from "../types";
import type { EtoroClient } from "./client";
import type { EtoroInstrumentCache } from "./instruments";

interface EtoroRate {
  instrumentID?: number;
  instrumentId?: number;
  ask?: number;
  bid?: number;
  lastExecution?: number;
  date?: string;
}

interface EtoroRatesResponse {
  rates?: EtoroRate[];
}

interface EtoroCandle {
  Close?: number;
  Open?: number;
  High?: number;
  Low?: number;
  FromDate?: string;
  InstrumentID?: number;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  fromDate?: string;
  instrumentId?: number;
}

interface EtoroCandlesResponse {
  Candles?: EtoroCandle[];
  candles?: EtoroCandle[];
}

const TIMEFRAME_TO_INTERVAL: Record<string, string> = {
  "1Min": "OneMinute",
  "5Min": "FiveMinutes",
  "15Min": "FifteenMinutes",
  "1Hour": "OneHour",
  "1Day": "OneDay",
};

const RATES_CACHE_TTL_MS = 15_000;

export class EtoroMarketDataProvider implements MarketDataProvider {
  private ratesCache: { data: EtoroRatesResponse; expiresAt: number } | null = null;
  private ratesPending: Promise<EtoroRatesResponse> | null = null;

  constructor(private client: EtoroClient, private instruments: EtoroInstrumentCache) {}

  /** Fetch ALL rates (no filter) with cache + inflight dedup. One call for everything. */
  private getAllRates(): Promise<EtoroRatesResponse> {
    const now = Date.now();
    if (this.ratesCache && now < this.ratesCache.expiresAt) {
      return Promise.resolve(this.ratesCache.data);
    }
    if (this.ratesPending) return this.ratesPending;
    this.ratesPending = this.client
      .marketDataRequest<EtoroRatesResponse>("GET", "/market-data/instruments/rates")
      .then((data) => {
        this.ratesCache = { data, expiresAt: Date.now() + RATES_CACHE_TTL_MS };
        this.ratesPending = null;
        return data;
      })
      .catch((err) => {
        this.ratesPending = null;
        throw err;
      });
    return this.ratesPending;
  }

  async getBars(symbol: string, timeframe: string, params?: BarsParams): Promise<Bar[]> {
    const instrumentId = await this.instruments.resolveInstrumentId(symbol);
    const interval = TIMEFRAME_TO_INTERVAL[timeframe] ?? "OneDay";
    const direction = "desc";
    const candlesCount = params?.limit ?? 100;

    const response = await this.client.marketDataRequest<EtoroCandlesResponse>(
      "GET",
      `/market-data/instruments/${instrumentId}/history/candles/${direction}/${interval}/${candlesCount}`
    );

    const candles = response.Candles ?? response.candles ?? [];
    return candles
      .filter((candle) => candle !== null)
      .map((candle) => this.parseCandle(candle))
      .filter((bar): bar is Bar => Boolean(bar));
  }

  async getLatestBar(symbol: string): Promise<Bar> {
    const bars = await this.getBars(symbol, "1Min", { limit: 1 });
    if (bars.length === 0) {
      throw new Error(`No bar data for ${symbol}`);
    }
    return bars[0]!;
  }

  async getLatestBars(symbols: string[]): Promise<Record<string, Bar>> {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const bar = await this.getLatestBar(symbol);
        return [symbol, bar] as const;
      })
    );

    return Object.fromEntries(results);
  }

  async getQuote(symbol: string): Promise<Quote> {
    const [quote] = Object.values(await this.getQuotes([symbol]));
    if (!quote) {
      throw new Error(`No quote data for ${symbol}`);
    }
    return quote;
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    if (symbols.length === 0) return {};

    // Batch-resolve all symbols → instrument IDs in parallel (cached after first resolve)
    const idMap = await this.instruments.resolveInstrumentIds(symbols);
    if (idMap.size === 0) return {};

    // One unfiltered /rates call (cached 15s) — no ID filter, no bad-ID failures
    const response = await this.getAllRates();

    // Build reverse map: instrumentId → input symbol
    const idToInputSymbol = new Map<number, string>();
    for (const [sym, id] of idMap) {
      idToInputSymbol.set(id, sym);
    }

    const result: Record<string, Quote> = {};

    for (const rate of response.rates ?? []) {
      const instrumentId = rate.instrumentId ?? rate.instrumentID;
      if (typeof instrumentId !== "number") continue;
      // Only include rates for instruments we asked about
      if (!idToInputSymbol.has(instrumentId)) continue;
      const symbol = idToInputSymbol.get(instrumentId)!;
      result[symbol] = {
        symbol,
        bid_price: rate.bid ?? 0,
        bid_size: 0,
        ask_price: rate.ask ?? 0,
        ask_size: 0,
        timestamp: rate.date ?? new Date().toISOString(),
      };
    }

    return result;
  }

  async getSnapshot(symbol: string): Promise<Snapshot> {
    const quote = await this.getQuote(symbol);
    const dailyBars = await this.getBars(symbol, "1Day", { limit: 2 });
    const minuteBars = await this.getBars(symbol, "1Min", { limit: 1 });

    const latestTradePrice = quote.ask_price || quote.bid_price || 0;

    return {
      symbol,
      latest_trade: {
        price: latestTradePrice,
        size: 0,
        timestamp: quote.timestamp,
      },
      latest_quote: quote,
      minute_bar: minuteBars[0] ?? this.emptyBar(quote.timestamp),
      daily_bar: dailyBars[0] ?? this.emptyBar(quote.timestamp),
      prev_daily_bar: dailyBars[1] ?? this.emptyBar(quote.timestamp),
    };
  }

  /**
   * Batch snapshots: one getQuotes call for all symbols (1 API call),
   * then fills in bar data from cache where available.
   */
  async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    if (symbols.length === 0) return {};

    // Pre-resolve all symbols in one parallel batch
    await this.instruments.resolveInstrumentIds(symbols);

    // Single batched rates call
    const quotes = await this.getQuotes(symbols);

    const result: Record<string, Snapshot> = {};
    for (const [symbol, quote] of Object.entries(quotes)) {
      const price = quote.ask_price || quote.bid_price || 0;
      result[symbol] = {
        symbol,
        latest_trade: {
          price,
          size: 0,
          timestamp: quote.timestamp,
        },
        latest_quote: quote,
        minute_bar: this.emptyBar(quote.timestamp),
        daily_bar: this.emptyBar(quote.timestamp),
        prev_daily_bar: this.emptyBar(quote.timestamp),
      };
    }
    return result;
  }

  async getCryptoSnapshot(symbol: string): Promise<Snapshot> {
    return this.getSnapshot(symbol);
  }

  private parseCandle(candle: EtoroCandle): Bar | null {
    const open = candle.Open ?? candle.open;
    const high = candle.High ?? candle.high;
    const low = candle.Low ?? candle.low;
    const close = candle.Close ?? candle.close;
    const timestamp = candle.FromDate ?? candle.fromDate;

    if (open === undefined || high === undefined || low === undefined || close === undefined || !timestamp) {
      return null;
    }

    return {
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: 0,
      n: 0,
      vw: 0,
    };
  }

  private emptyBar(timestamp: string): Bar {
    return { t: timestamp, o: 0, h: 0, l: 0, c: 0, v: 0, n: 0, vw: 0 };
  }
}

export function createEtoroMarketDataProvider(
  client: EtoroClient,
  instruments: EtoroInstrumentCache
): EtoroMarketDataProvider {
  return new EtoroMarketDataProvider(client, instruments);
}
