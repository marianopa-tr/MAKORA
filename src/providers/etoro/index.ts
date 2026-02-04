import type { Env } from "../../env.d";
import { createEtoroClient } from "./client";
import { EtoroInstrumentCache } from "./instruments";
import { createEtoroMarketDataProvider, type EtoroMarketDataProvider } from "./market-data";
import { createEtoroOptionsProvider, type EtoroOptionsProvider } from "./options";
import { createEtoroTradingProvider, type EtoroTradingProvider } from "./trading";

export interface EtoroProviders {
  trading: EtoroTradingProvider;
  marketData: EtoroMarketDataProvider;
  options: EtoroOptionsProvider;
}

export function createEtoroProviders(env: Env): EtoroProviders {
  if (!env.ETORO_API_KEY || !env.ETORO_USER_KEY) {
    throw new Error("ETORO_API_KEY and ETORO_USER_KEY are required");
  }

  const normalizedEnv = env.ETORO_ENV?.toLowerCase() === "real" ? "real" : "demo";
  const client = createEtoroClient({
    apiKey: env.ETORO_API_KEY,
    userKey: env.ETORO_USER_KEY,
    env: normalizedEnv,
  });

  const instruments = new EtoroInstrumentCache(client);

  return {
    trading: createEtoroTradingProvider(client, instruments),
    marketData: createEtoroMarketDataProvider(client, instruments),
    options: createEtoroOptionsProvider(),
  };
}

export { EtoroClient, createEtoroClient } from "./client";
export { EtoroMarketDataProvider } from "./market-data";
export { EtoroTradingProvider } from "./trading";
