import { createError, ErrorCode } from "../../lib/errors";
import { generateId } from "../../lib/utils";

export type EtoroEnvironment = "demo" | "real";

export interface EtoroClientConfig {
  apiKey: string;
  userKey: string;
  env?: EtoroEnvironment;
  baseUrl?: string;
  debug?: boolean;
  /** Max requests per minute. Default: 55 (below the 60/min hard limit). */
  maxRequestsPerMinute?: number;
}

/**
 * Sliding-window rate limiter.
 * Tracks timestamps of recent requests and delays when at capacity.
 */
class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs = 60_000; // 1 minute

  constructor(maxRequests: number) {
    this.maxRequests = maxRequests;
  }

  /** Wait until a request slot is available, then consume it. */
  async acquire(): Promise<void> {
    this.prune();
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0]!;
      const waitMs = oldest + this.windowMs - Date.now() + 50; // +50ms safety margin
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        this.prune();
      }
    }
    this.timestamps.push(Date.now());
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }

  get pending(): number {
    this.prune();
    return this.timestamps.length;
  }
}

export class EtoroClient {
  private baseUrl: string;
  private apiKey: string;
  private userKey: string;
  private env: EtoroEnvironment;
  private debug: boolean;
  private rateLimiter: RateLimiter;

  constructor(config: EtoroClientConfig) {
    this.baseUrl = (config.baseUrl ?? "https://public-api.etoro.com/api/v1").trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.userKey = config.userKey;
    this.env = config.env ?? "demo";
    this.debug = config.debug ?? false;
    this.rateLimiter = new RateLimiter(config.maxRequestsPerMinute ?? 55);
  }

  getEnvironment(): EtoroEnvironment {
    return this.env;
  }

  async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; params?: Record<string, string | number | (string | number)[] | undefined> } = {}
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    const requestId = this.createRequestId();

    if (options.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          searchParams.set(key, value.join(","));
        } else {
          searchParams.set(key, String(value));
        }
      }
      const query = searchParams.toString();
      if (query) {
        url += `?${query}`;
      }
    }

    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "x-user-key": this.userKey,
      "x-request-id": requestId,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    // Wait for a rate-limiter slot before sending
    await this.rateLimiter.acquire();

    this.logDebug("request", {
      method,
      path,
      params: options.params ?? null,
      body: options.body ?? null,
      env: this.env,
      requestId,
      pending: this.rateLimiter.pending,
    });

    const response = await fetch(url, init);
    this.logDebug("response", { method, path, status: response.status, requestId });
    if (!response.ok) {
      const errorBody = await response.text();
      this.logDebug("error", {
        method,
        path,
        status: response.status,
        requestId,
        body: this.truncateForLog(errorBody),
      });
      let message = errorBody;

      try {
        const parsed = JSON.parse(errorBody) as { message?: string; error?: { message?: string } };
        message = parsed.error?.message ?? parsed.message ?? errorBody;
      } catch {
        // keep raw body
      }

      if (response.status === 401) {
        throw createError(ErrorCode.UNAUTHORIZED, `eToro authentication failed: ${message}`);
      }
      if (response.status === 403) {
        throw createError(ErrorCode.FORBIDDEN, `eToro access denied: ${message}`);
      }
      if (response.status === 404) {
        throw createError(ErrorCode.NOT_FOUND, `eToro resource not found: ${message}`);
      }
      if (response.status === 400 || response.status === 422) {
        throw createError(ErrorCode.INVALID_INPUT, `eToro validation error: ${message}`);
      }
      if (response.status === 429) {
        throw createError(ErrorCode.RATE_LIMITED, `eToro rate limit exceeded: ${message}`);
      }

      throw createError(ErrorCode.PROVIDER_ERROR, `eToro API error (${response.status}): ${message}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async tradingRequest<T>(
    method: string,
    path: string,
    options?: { body?: unknown; params?: Record<string, string | number | (string | number)[] | undefined> }
  ): Promise<T> {
    return this.request<T>(method, path, options);
  }

  async marketDataRequest<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | (string | number)[] | undefined>
  ): Promise<T> {
    return this.request<T>(method, path, { params });
  }

  private createRequestId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return generateId();
  }

  private logDebug(event: string, payload: Record<string, unknown>): void {
    if (!this.debug) return;
    const ts = new Date().toISOString();
    console.log(`[${ts}] [EtoroClient] ${event}`, payload);
  }

  private truncateForLog(value: string, maxLength = 800): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
  }
}

export function createEtoroClient(config: EtoroClientConfig): EtoroClient {
  return new EtoroClient(config);
}
