import type { Env } from "../../env.d";
import { parseBoolean } from "../../lib/utils";
import { type AlpacaClientConfig, createAlpacaClient } from "./client";
import { type AlpacaMarketDataProvider, createAlpacaMarketDataProvider } from "./market-data";
import { type AlpacaOptionsProvider, createAlpacaOptionsProvider } from "./options";
import { type AlpacaTradingProvider, createAlpacaTradingProvider } from "./trading";

export interface AlpacaProviders {
  trading: AlpacaTradingProvider;
  marketData: AlpacaMarketDataProvider;
  options: AlpacaOptionsProvider;
}

export function createAlpacaProviders(env: Env): AlpacaProviders {
  const config: AlpacaClientConfig = {
    apiKey: env.ALPACA_API_KEY ?? "",
    apiSecret: env.ALPACA_API_SECRET ?? "",
    paper: parseBoolean(env.ALPACA_PAPER, true),
  };

  const client = createAlpacaClient(config);

  return {
    trading: createAlpacaTradingProvider(client),
    marketData: createAlpacaMarketDataProvider(client),
    options: createAlpacaOptionsProvider(client),
  };
}

export { AlpacaClient, createAlpacaClient } from "./client";
export { AlpacaMarketDataProvider } from "./market-data";
export { AlpacaTradingProvider } from "./trading";
