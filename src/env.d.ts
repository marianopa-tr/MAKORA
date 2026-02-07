export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARTIFACTS: R2Bucket;
  SESSION: DurableObjectNamespace;
  MAKORA_HARNESS?: DurableObjectNamespace;

  ETORO_API_KEY: string;
  ETORO_USER_KEY: string;
  ETORO_ENV?: "demo" | "real";
  /** @deprecated Alpaca credentials kept for backward compatibility */
  ALPACA_API_KEY?: string;
  /** @deprecated Alpaca credentials kept for backward compatibility */
  ALPACA_API_SECRET?: string;
  /** @deprecated Alpaca credentials kept for backward compatibility */
  ALPACA_PAPER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  AZURE_API_KEY?: string;
  AZURE_ENDPOINT?: string;
  AZURE_RESOURCE_NAME?: string;
  AZURE_DEPLOYMENT?: string;
  AZURE_API_VERSION?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  XAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  LLM_PROVIDER?: "openai-raw" | "ai-sdk" | "cloudflare-gateway" | "azure-openai";
  LLM_MODEL?: string;
  DEBUG?: string;
  TWITTER_BEARER_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
  MAKORA_API_TOKEN: string;
  KILL_SWITCH_SECRET: string;

  ENVIRONMENT: string;
  /** "full" (default) = all routes, "app" = app-only mode (self-service at root) */
  WORKER_MODE?: "full" | "app";
  FEATURE_LLM_RESEARCH: string;
  FEATURE_OPTIONS: string;

  DEFAULT_MAX_POSITION_PCT: string;
  DEFAULT_MAX_NOTIONAL_PER_TRADE: string;
  DEFAULT_MAX_DAILY_LOSS_PCT: string;
  DEFAULT_COOLDOWN_MINUTES: string;
  DEFAULT_MAX_OPEN_POSITIONS: string;
  DEFAULT_APPROVAL_TTL_SECONDS: string;
}

declare module "cloudflare:workers" {
  interface Env extends Env { }
}
