import { createError, ErrorCode } from "../../lib/errors";
import { generateId } from "../../lib/utils";

export type EtoroEnvironment = "demo" | "real";

export interface EtoroClientConfig {
  apiKey: string;
  userKey: string;
  env?: EtoroEnvironment;
  baseUrl?: string;
}

export class EtoroClient {
  private baseUrl: string;
  private apiKey: string;
  private userKey: string;
  private env: EtoroEnvironment;

  constructor(config: EtoroClientConfig) {
    this.baseUrl = (config.baseUrl ?? "https://public-api.etoro.com/api/v1").trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.userKey = config.userKey;
    this.env = config.env ?? "demo";
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
      "x-request-id": this.createRequestId(),
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      const errorBody = await response.text();
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
}

export function createEtoroClient(config: EtoroClientConfig): EtoroClient {
  return new EtoroClient(config);
}
