import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEtoroClient } from "./client";
import { EtoroInstrumentCache } from "./instruments";
import { createEtoroMarketDataProvider } from "./market-data";

describe("eToro Market Data Provider", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches quotes using search + rates + metadata", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ instrumentId: 123, internalSymbolFull: "AAPL" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rates: [{ instrumentID: 123, bid: 100, ask: 101, date: "2025-01-01T00:00:00Z" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          instrumentDisplayDatas: [{ instrumentId: 123, symbolFull: "AAPL" }],
        }),
      });

    const client = createEtoroClient({ apiKey: "key", userKey: "user", env: "demo" });
    const instruments = new EtoroInstrumentCache(client);
    const provider = createEtoroMarketDataProvider(client, instruments);

    const quote = await provider.getQuote("AAPL");

    expect(quote.symbol).toBe("AAPL");
    expect(quote.bid_price).toBe(100);
    expect(quote.ask_price).toBe(101);
    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toContain("/market-data/search");
    expect(urls[1]).toContain("/market-data/instruments/rates");
    if (urls[2]) {
      expect(urls[2]).toContain("/market-data/instruments");
    }
  });
});
