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

type ProviderCache = {
  key: string;
  providers: EtoroProviders;
};

let cachedProviders: ProviderCache | null = null;

export function createEtoroProviders(env: Env): EtoroProviders {
  if (!env.ETORO_API_KEY || !env.ETORO_USER_KEY) {
    throw new Error("ETORO_API_KEY and ETORO_USER_KEY are required");
  }

  const normalizedEnv = env.ETORO_ENV?.toLowerCase() === "real" ? "real" : "demo";
  const debugFlag = env.DEBUG?.toLowerCase();
  const debugEnabled = debugFlag === "true" || debugFlag === "1" || debugFlag === "etoro";
  const cacheKey = `${normalizedEnv}:${env.ETORO_API_KEY}:${env.ETORO_USER_KEY}:${debugEnabled ? "debug" : "nodebug"}`;
  if (cachedProviders?.key === cacheKey) {
    return cachedProviders.providers;
  }

  const client = createEtoroClient({
    apiKey: env.ETORO_API_KEY,
    userKey: env.ETORO_USER_KEY,
    env: normalizedEnv,
    debug: debugEnabled,
  });

  const instruments = new EtoroInstrumentCache(client);

  const providers: EtoroProviders = {
    trading: createEtoroTradingProvider(client, instruments),
    marketData: createEtoroMarketDataProvider(client, instruments),
    options: createEtoroOptionsProvider(),
  };
  cachedProviders = { key: cacheKey, providers };
  return providers;
}

export { EtoroClient, createEtoroClient } from "./client";
export { EtoroMarketDataProvider } from "./market-data";
export { EtoroTradingProvider } from "./trading";
