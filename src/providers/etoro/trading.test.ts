import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEtoroClient } from "./client";
import { EtoroInstrumentCache } from "./instruments";
import { createEtoroTradingProvider } from "./trading";

describe("eToro Trading Provider", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates market order using units derived from notional", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ instrumentId: 999, internalSymbolFull: "AAPL" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rates: [{ instrumentId: 999, ask: 200, bid: 199, lastExecution: 199.5 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          orderForOpen: {
            orderID: 555,
            statusID: 1,
            instrumentID: 999,
            amountInUnits: 0.5,
            openDateTime: "2025-01-01T00:00:00Z",
          },
        }),
      });

    const client = createEtoroClient({ apiKey: "key", userKey: "user", env: "demo" });
    const instruments = new EtoroInstrumentCache(client);
    const provider = createEtoroTradingProvider(client, instruments);

    const order = await provider.createOrder({
      symbol: "AAPL",
      notional: 100,
      side: "buy",
      type: "market",
      time_in_force: "day",
    });

    expect(order.id).toBe("555");
    expect(order.symbol).toBe("AAPL");

    const call = mockFetch.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.AmountInUnits).toBeCloseTo(0.5, 6);
    expect(body.InstrumentID).toBe(999);
    expect(body.IsBuy).toBe(true);
  });
});
