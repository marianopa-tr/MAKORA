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

type CachedInstrument = {
  symbol: string;
  instrumentTypeId?: number;
  exchangeId?: number;
  updatedAt: number;
};

export class EtoroInstrumentCache {
  private symbolToId = new Map<string, { id: number; updatedAt: number }>();
  private idToMeta = new Map<number, CachedInstrument>();
  private readonly ttlMs = 30 * 60 * 1000;

  constructor(private client: EtoroClient) {}

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

  async resolveSymbol(instrumentId: number): Promise<string> {
    const cached = this.idToMeta.get(instrumentId);
    if (cached && this.isFresh(cached.updatedAt)) {
      return cached.symbol;
    }

    const meta = await this.fetchInstrumentMetadata([instrumentId]);
    const found = meta.get(instrumentId);
    if (found) {
      return found.symbol;
    }

    return String(instrumentId);
  }

  async resolveMetadata(instrumentIds: number[]): Promise<Map<number, CachedInstrument>> {
    const result = new Map<number, CachedInstrument>();
    const missing: number[] = [];

    const uniqueIds = Array.from(new Set(instrumentIds));
    for (const id of uniqueIds) {
      const cached = this.idToMeta.get(id);
      if (cached && this.isFresh(cached.updatedAt)) {
        result.set(id, cached);
      } else {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const fetched = await this.fetchInstrumentMetadata(missing);
      for (const [id, meta] of fetched.entries()) {
        result.set(id, meta);
      }
    }

    return result;
  }

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

  private async fetchInstrumentMetadata(instrumentIds: number[]): Promise<Map<number, CachedInstrument>> {
    const result = new Map<number, CachedInstrument>();

    for (let i = 0; i < instrumentIds.length; i += 100) {
      const chunk = instrumentIds.slice(i, i + 100);
      try {
        const response = await this.client.marketDataRequest<EtoroInstrumentMetadataResponse>(
          "GET",
          "/market-data/instruments",
          { instrumentIds: chunk }
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

        const missingIds = chunk.filter((id) => !result.has(id));
        for (const id of missingIds.slice(0, 25)) {
          try {
            const singleResponse = await this.client.marketDataRequest<EtoroInstrumentMetadataResponse>(
              "GET",
              "/market-data/instruments",
              { instrumentIds: [id] }
            );
            for (const item of singleResponse.instrumentDisplayDatas ?? []) {
              const parsedId = item.instrumentId ?? item.instrumentID;
              if (typeof parsedId !== "number") continue;
              const symbol =
                item.symbolFull?.toUpperCase() ?? item.instrumentDisplayName?.toUpperCase() ?? String(parsedId);
              const meta: CachedInstrument = {
                symbol,
                instrumentTypeId: item.instrumentTypeId,
                exchangeId: item.exchangeId,
                updatedAt: Date.now(),
              };
              this.idToMeta.set(parsedId, meta);
              result.set(parsedId, meta);
            }
          } catch {
            // ignore single-id failures
          }
        }
      } catch {
        for (const id of chunk.slice(0, 25)) {
          try {
            const singleResponse = await this.client.marketDataRequest<EtoroInstrumentMetadataResponse>(
              "GET",
              "/market-data/instruments",
              { instrumentIds: [id] }
            );
            for (const item of singleResponse.instrumentDisplayDatas ?? []) {
              const parsedId = item.instrumentId ?? item.instrumentID;
              if (typeof parsedId !== "number") continue;
              const symbol =
                item.symbolFull?.toUpperCase() ?? item.instrumentDisplayName?.toUpperCase() ?? String(parsedId);
              const meta: CachedInstrument = {
                symbol,
                instrumentTypeId: item.instrumentTypeId,
                exchangeId: item.exchangeId,
                updatedAt: Date.now(),
              };
              this.idToMeta.set(parsedId, meta);
              result.set(parsedId, meta);
            }
          } catch {
            // ignore single-id failures
          }
        }
      }
    }

    return result;
  }

  private isFresh(updatedAt: number): boolean {
    return Date.now() - updatedAt < this.ttlMs;
  }
}
