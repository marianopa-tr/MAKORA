import { createError, ErrorCode } from "../../lib/errors";
import type { EtoroClient } from "./client";

interface EtoroSearchItem {
  instrumentId?: number;
  instrumentID?: number;
  internalSymbolFull?: string;
  symbolFull?: string;
  fullSymbolName?: string;
  displayName?: string;
  name?: string;
  typeName?: string;
}

interface EtoroSearchResponse {
  items?: EtoroSearchItem[];
  instruments?: { items?: EtoroSearchItem[] };
}

interface EtoroInstrumentDisplayData {
  instrumentId?: number;
  instrumentID?: number;
  instrumentDisplayName?: string;
  instrumentTypeId?: number;
  exchangeId?: number;
  symbolFull?: string;
}

interface EtoroInstrumentMetadataResponse {
  instrumentDisplayDatas?: EtoroInstrumentDisplayData[];
}

export type CachedInstrument = {
  symbol: string;
  instrumentTypeId?: number;
  exchangeId?: number;
  updatedAt: number;
};

/** Max concurrent search requests to avoid bursts. */
const SEARCH_CONCURRENCY = 5;

/** How long to wait before re-fetching the full instruments list. */
const ALL_INSTRUMENTS_CACHE_TTL_MS = 60_000; // 60 seconds

export class EtoroInstrumentCache {
  private symbolToId = new Map<string, { id: number; updatedAt: number }>();
  private idToMeta = new Map<number, CachedInstrument>();
  private readonly ttlMs = 30 * 60 * 1000;

  /** In-flight promise dedup for resolveMetadata. */
  private metadataPending: Promise<Map<number, CachedInstrument>> | null = null;

  /** Timestamp of last successful full-instruments fetch. */
  private allInstrumentsFetchedAt = 0;

  constructor(private client: EtoroClient) {}

  // ---- Single-symbol (uses cache, falls back to search) ----

  async resolveInstrumentId(symbol: string): Promise<number> {
    const normalized = symbol.trim().toUpperCase();
    const cached = this.symbolToId.get(normalized);
    if (cached && this.isFresh(cached.updatedAt)) {
      return cached.id;
    }

    const candidates = this.buildSymbolCandidates(normalized);
    for (const candidate of candidates) {
      const item = await this.searchExactSymbol(candidate);
      if (item?.id) {
        this.storeMapping(candidate, item.id, item.symbol);
        return item.id;
      }
    }

    throw createError(ErrorCode.NOT_FOUND, `Unknown symbol ${symbol}`);
  }

  // ---- Batch: resolve many symbols in parallel, one metadata call ----

  /**
   * Resolve multiple symbols to instrument IDs in parallel (limited concurrency).
   * Symbols already in cache are returned instantly; uncached ones are searched
   * concurrently (up to SEARCH_CONCURRENCY at a time).
   * After all IDs are resolved, a single batch `/market-data/instruments` call
   * populates the metadata cache.
   */
  async resolveInstrumentIds(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const toSearch: string[] = [];

    for (const raw of symbols) {
      const normalized = raw.trim().toUpperCase();
      const cached = this.symbolToId.get(normalized);
      if (cached && this.isFresh(cached.updatedAt)) {
        result.set(normalized, cached.id);
      } else {
        toSearch.push(normalized);
      }
    }

    if (toSearch.length > 0) {
      // Run searches in parallel with limited concurrency
      const resolvedIds = await this.parallelSearch(toSearch);
      for (const [symbol, id] of resolvedIds) {
        result.set(symbol, id);
      }

      // Batch-fetch metadata for ALL resolved IDs in one call
      const allIds = [...result.values()];
      if (allIds.length > 0) {
        await this.resolveMetadata(allIds);
      }
    }

    return result;
  }

  /** Run searches with limited concurrency to avoid bursting through the rate limit. */
  private async parallelSearch(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const unique = [...new Set(symbols)];

    // Process in batches of SEARCH_CONCURRENCY
    for (let i = 0; i < unique.length; i += SEARCH_CONCURRENCY) {
      const batch = unique.slice(i, i + SEARCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (symbol) => {
          const candidates = this.buildSymbolCandidates(symbol);
          for (const candidate of candidates) {
            const item = await this.searchExactSymbol(candidate);
            if (item?.id) {
              this.storeMapping(candidate, item.id, item.symbol);
              return { symbol, id: item.id };
            }
          }
          return null;
        })
      );

      for (const outcome of settled) {
        if (outcome.status === "fulfilled" && outcome.value) {
          result.set(outcome.value.symbol, outcome.value.id);
        }
      }
    }

    return result;
  }

  // ---- Symbol → metadata ----

  async resolveSymbol(instrumentId: number): Promise<string> {
    const cached = this.idToMeta.get(instrumentId);
    if (cached && this.isFresh(cached.updatedAt)) {
      return cached.symbol;
    }

    // Use resolveMetadata which respects the full-instruments cache TTL
    const meta = await this.resolveMetadata([instrumentId]);
    const found = meta.get(instrumentId);
    if (found) {
      return found.symbol;
    }

    return String(instrumentId);
  }

  async resolveMetadata(instrumentIds: number[]): Promise<Map<number, CachedInstrument>> {
    const result = new Map<number, CachedInstrument>();

    const uniqueIds = Array.from(new Set(instrumentIds));
    let missing = 0;
    for (const id of uniqueIds) {
      const cached = this.idToMeta.get(id);
      if (cached && this.isFresh(cached.updatedAt)) {
        result.set(id, cached);
      } else {
        missing++;
      }
    }

    // Only re-fetch if we have missing IDs AND the full list wasn't fetched recently
    const allInstrumentsFresh = Date.now() - this.allInstrumentsFetchedAt < ALL_INSTRUMENTS_CACHE_TTL_MS;
    if (missing > 0 && !allInstrumentsFresh) {
      let fetched: Map<number, CachedInstrument>;
      if (this.metadataPending) {
        fetched = await this.metadataPending;
      } else {
        this.metadataPending = this.fetchInstrumentMetadata(uniqueIds)
          .then((data) => {
            this.allInstrumentsFetchedAt = Date.now();
            this.metadataPending = null;
            return data;
          })
          .catch((err) => { this.metadataPending = null; throw err; });
        fetched = await this.metadataPending;
      }
      // Re-check after fetch — the unfiltered call populates idToMeta for all instruments
      for (const id of uniqueIds) {
        const meta = fetched.get(id) ?? this.idToMeta.get(id);
        if (meta) result.set(id, meta);
      }
    }

    return result;
  }

  /** Get metadata for a single instrument ID from cache (no API call). */
  getCachedMeta(instrumentId: number): CachedInstrument | undefined {
    const cached = this.idToMeta.get(instrumentId);
    if (cached && this.isFresh(cached.updatedAt)) return cached;
    return undefined;
  }

  // ---- Private helpers ----

  private async searchExactSymbol(
    symbol: string
  ): Promise<{ id: number; symbol: string } | null> {
    const response = await this.client.marketDataRequest<EtoroSearchResponse>("GET", "/market-data/search", {
      internalSymbolFull: symbol,
    });

    const items = this.extractItems(response);
    const direct = items.find((item) => this.extractSymbol(item) === symbol);
    const candidate = direct ?? items[0];
    if (!candidate) return null;

    const id = this.extractInstrumentId(candidate);
    const foundSymbol = this.extractSymbol(candidate) ?? symbol;
    if (!id) return null;

    return { id, symbol: foundSymbol };
  }

  private extractItems(response: EtoroSearchResponse): EtoroSearchItem[] {
    if (response.items && Array.isArray(response.items)) {
      return response.items;
    }
    if (response.instruments?.items && Array.isArray(response.instruments.items)) {
      return response.instruments.items;
    }
    return [];
  }

  private extractInstrumentId(item: EtoroSearchItem): number | null {
    const id = item.instrumentId ?? item.instrumentID;
    return typeof id === "number" ? id : null;
  }

  private extractSymbol(item: EtoroSearchItem): string | null {
    const value =
      item.internalSymbolFull ??
      item.symbolFull ??
      item.fullSymbolName ??
      item.displayName ??
      item.name;
    return value ? value.toUpperCase() : null;
  }

  private buildSymbolCandidates(symbol: string): string[] {
    const candidates = new Set<string>([symbol]);

    if (symbol.includes("/")) {
      candidates.add(symbol.replace("/", ""));
      candidates.add(symbol.split("/")[0] ?? symbol);
    } else if (symbol.endsWith("USD")) {
      candidates.add(symbol.replace("USD", ""));
      candidates.add(`${symbol}/USD`);
    }

    return Array.from(candidates);
  }

  private storeMapping(symbol: string, id: number, displaySymbol?: string): void {
    const normalized = symbol.toUpperCase();
    this.symbolToId.set(normalized, { id, updatedAt: Date.now() });
    if (displaySymbol) {
      this.idToMeta.set(id, {
        symbol: displaySymbol.toUpperCase(),
        updatedAt: Date.now(),
      });
    }
  }

  private async fetchInstrumentMetadata(_instrumentIds: number[]): Promise<Map<number, CachedInstrument>> {
    const result = new Map<number, CachedInstrument>();

    // Call /instruments without filters — avoids 500s caused by invalid IDs in the batch.
    // eToro returns all known instruments; we cache everything and look up what we need.
    try {
      const response = await this.client.marketDataRequest<EtoroInstrumentMetadataResponse>(
        "GET",
        "/market-data/instruments"
      );

      for (const item of response.instrumentDisplayDatas ?? []) {
        const id = item.instrumentId ?? item.instrumentID;
        if (typeof id !== "number") continue;
        const symbol = item.symbolFull?.toUpperCase() ?? item.instrumentDisplayName?.toUpperCase() ?? String(id);
        const meta: CachedInstrument = {
          symbol,
          instrumentTypeId: item.instrumentTypeId,
          exchangeId: item.exchangeId,
          updatedAt: Date.now(),
        };
        this.idToMeta.set(id, meta);
        result.set(id, meta);
      }
    } catch {
      // Failed — return whatever we have from cache; no retries
    }

    return result;
  }

  private isFresh(updatedAt: number): boolean {
    return Date.now() - updatedAt < this.ttlMs;
  }
}
