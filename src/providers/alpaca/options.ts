import type { OptionContract, OptionSnapshot, OptionsChain, OptionsProvider } from "../types";
import type { AlpacaClient } from "./client";

// ============================================================================
// Alpaca Options API Types
// ============================================================================

interface AlpacaOptionContract {
  id: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  expiration_date: string;
  root_symbol: string;
  underlying_symbol: string;
  underlying_asset_id: string;
  type: "call" | "put";
  style: "american" | "european";
  strike_price: string;
  size: string;
  open_interest: string;
  open_interest_date: string;
  close_price: string;
  close_price_date: string;
}

interface AlpacaOptionsContractsResponse {
  option_contracts: AlpacaOptionContract[];
  next_page_token?: string;
}

interface AlpacaOptionQuote {
  symbol: string;
  bid_price: number;
  bid_size: number;
  ask_price: number;
  ask_size: number;
  bid_exchange: string;
  ask_exchange: string;
  timestamp: string;
}

interface AlpacaOptionTrade {
  symbol: string;
  price: number;
  size: number;
  exchange: string;
  timestamp: string;
}

interface AlpacaOptionSnapshot {
  latest_quote: AlpacaOptionQuote;
  latest_trade: AlpacaOptionTrade;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  implied_volatility?: number;
}

interface AlpacaOptionSnapshotsResponse {
  snapshots: Record<string, AlpacaOptionSnapshot>;
}

// ============================================================================
// Options Contract Query Parameters
// ============================================================================

export interface OptionsContractsParams {
  underlying_symbols?: string[];
  status?: "active" | "inactive";
  expiration_date?: string;
  expiration_date_gte?: string;
  expiration_date_lte?: string;
  root_symbol?: string;
  type?: "call" | "put";
  style?: "american" | "european";
  strike_price_gte?: number;
  strike_price_lte?: number;
  limit?: number;
  page_token?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseOptionContract(raw: AlpacaOptionContract): OptionContract {
  return {
    symbol: raw.symbol,
    underlying: raw.underlying_symbol,
    expiration: raw.expiration_date,
    strike: parseFloat(raw.strike_price),
    type: raw.type,
    open_interest: parseInt(raw.open_interest, 10) || 0,
    volume: 0, // Not provided in contract response, need snapshot
  };
}

function parseOptionSnapshot(symbol: string, raw: AlpacaOptionSnapshot): OptionSnapshot {
  return {
    symbol,
    latest_quote: {
      bid_price: raw.latest_quote?.bid_price || 0,
      bid_size: raw.latest_quote?.bid_size || 0,
      ask_price: raw.latest_quote?.ask_price || 0,
      ask_size: raw.latest_quote?.ask_size || 0,
    },
    greeks: raw.greeks,
    implied_volatility: raw.implied_volatility,
  };
}

// ============================================================================
// Alpaca Options Provider
// ============================================================================

export class AlpacaOptionsProvider implements OptionsProvider {
  constructor(private client: AlpacaClient) {}

  isConfigured(): boolean {
    return true;
  }

  /**
   * Get available expiration dates for an underlying symbol
   */
  async getExpirations(underlying: string): Promise<string[]> {
    const contracts = await this.getContracts({
      underlying_symbols: [underlying.toUpperCase()],
      status: "active",
      limit: 1000,
    });

    // Extract unique expiration dates
    const expirations = new Set<string>();
    for (const contract of contracts) {
      expirations.add(contract.expiration);
    }

    // Sort by date
    return Array.from(expirations).sort();
  }

  /**
   * Get options chain for a symbol and expiration
   */
  async getChain(underlying: string, expiration: string): Promise<OptionsChain> {
    const contracts = await this.getContracts({
      underlying_symbols: [underlying.toUpperCase()],
      expiration_date: expiration,
      status: "active",
      limit: 500,
    });

    const calls: OptionContract[] = [];
    const puts: OptionContract[] = [];

    for (const contract of contracts) {
      if (contract.type === "call") {
        calls.push(contract);
      } else {
        puts.push(contract);
      }
    }

    // Sort by strike price
    calls.sort((a, b) => a.strike - b.strike);
    puts.sort((a, b) => a.strike - b.strike);

    return {
      symbol: underlying.toUpperCase(),
      expiration,
      calls,
      puts,
    };
  }

  /**
   * Get snapshot (quote + greeks) for a single contract
   */
  async getSnapshot(contractSymbol: string): Promise<OptionSnapshot> {
    const snapshots = await this.getSnapshots([contractSymbol]);
    const snapshot = snapshots[contractSymbol];

    if (!snapshot) {
      // Return empty snapshot if not found
      return {
        symbol: contractSymbol,
        latest_quote: {
          bid_price: 0,
          bid_size: 0,
          ask_price: 0,
          ask_size: 0,
        },
      };
    }

    return snapshot;
  }

  /**
   * Get snapshots for multiple contracts
   */
  async getSnapshots(contractSymbols: string[]): Promise<Record<string, OptionSnapshot>> {
    if (contractSymbols.length === 0) {
      return {};
    }

    const symbols = contractSymbols.join(",");
    const response = await this.client.dataRequest<AlpacaOptionSnapshotsResponse>(
      "GET",
      `/v1beta1/options/snapshots?symbols=${encodeURIComponent(symbols)}`
    );

    const result: Record<string, OptionSnapshot> = {};
    for (const [symbol, snapshot] of Object.entries(response.snapshots || {})) {
      result[symbol] = parseOptionSnapshot(symbol, snapshot);
    }

    return result;
  }

  /**
   * Get contracts with various filters
   */
  async getContracts(params: OptionsContractsParams = {}): Promise<OptionContract[]> {
    const searchParams = new URLSearchParams();

    if (params.underlying_symbols?.length) {
      searchParams.set("underlying_symbols", params.underlying_symbols.join(","));
    }
    if (params.status) {
      searchParams.set("status", params.status);
    }
    if (params.expiration_date) {
      searchParams.set("expiration_date", params.expiration_date);
    }
    if (params.expiration_date_gte) {
      searchParams.set("expiration_date_gte", params.expiration_date_gte);
    }
    if (params.expiration_date_lte) {
      searchParams.set("expiration_date_lte", params.expiration_date_lte);
    }
    if (params.root_symbol) {
      searchParams.set("root_symbol", params.root_symbol);
    }
    if (params.type) {
      searchParams.set("type", params.type);
    }
    if (params.style) {
      searchParams.set("style", params.style);
    }
    if (params.strike_price_gte !== undefined) {
      searchParams.set("strike_price_gte", String(params.strike_price_gte));
    }
    if (params.strike_price_lte !== undefined) {
      searchParams.set("strike_price_lte", String(params.strike_price_lte));
    }
    if (params.limit) {
      searchParams.set("limit", String(params.limit));
    }
    if (params.page_token) {
      searchParams.set("page_token", params.page_token);
    }

    const queryString = searchParams.toString();
    const path = `/v2/options/contracts${queryString ? `?${queryString}` : ""}`;

    const response = await this.client.tradingRequest<AlpacaOptionsContractsResponse>("GET", path);

    return (response.option_contracts || []).map(parseOptionContract);
  }

  /**
   * Get a single contract by symbol or ID
   */
  async getContract(symbolOrId: string): Promise<OptionContract | null> {
    try {
      const response = await this.client.tradingRequest<AlpacaOptionContract>(
        "GET",
        `/v2/options/contracts/${encodeURIComponent(symbolOrId)}`
      );
      return parseOptionContract(response);
    } catch (error) {
      if ((error as { code?: string }).code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find contracts matching criteria (helper for option selection)
   */
  async findContracts(
    underlying: string,
    options: {
      type: "call" | "put";
      minDTE?: number;
      maxDTE?: number;
      minStrike?: number;
      maxStrike?: number;
      nearestToStrike?: number;
      limit?: number;
    }
  ): Promise<OptionContract[]> {
    // Calculate date range from DTE
    const today = new Date();
    const minDate = new Date(today);
    const maxDate = new Date(today);

    if (options.minDTE) {
      minDate.setDate(minDate.getDate() + options.minDTE);
    }
    if (options.maxDTE) {
      maxDate.setDate(maxDate.getDate() + options.maxDTE);
    } else {
      maxDate.setDate(maxDate.getDate() + 90); // Default 90 days max
    }

    const contracts = await this.getContracts({
      underlying_symbols: [underlying.toUpperCase()],
      type: options.type,
      status: "active",
      expiration_date_gte: minDate.toISOString().split("T")[0],
      expiration_date_lte: maxDate.toISOString().split("T")[0],
      strike_price_gte: options.minStrike,
      strike_price_lte: options.maxStrike,
      limit: options.limit || 100,
    });

    // If looking for nearest to a specific strike, sort by distance
    if (options.nearestToStrike !== undefined) {
      contracts.sort((a, b) => {
        const distA = Math.abs(a.strike - options.nearestToStrike!);
        const distB = Math.abs(b.strike - options.nearestToStrike!);
        return distA - distB;
      });
    }

    return contracts;
  }
}

export function createAlpacaOptionsProvider(client: AlpacaClient): AlpacaOptionsProvider {
  return new AlpacaOptionsProvider(client);
}
