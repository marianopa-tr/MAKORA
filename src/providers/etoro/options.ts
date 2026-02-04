import { createError, ErrorCode } from "../../lib/errors";
import type { OptionSnapshot, OptionsChain, OptionsProvider } from "../types";

export class EtoroOptionsProvider implements OptionsProvider {
  isConfigured(): boolean {
    return false;
  }

  async getExpirations(_underlying: string): Promise<string[]> {
    throw createError(ErrorCode.NOT_SUPPORTED, "Options trading is not supported by the eToro provider");
  }

  async getChain(_underlying: string, _expiration: string): Promise<OptionsChain> {
    throw createError(ErrorCode.NOT_SUPPORTED, "Options trading is not supported by the eToro provider");
  }

  async getSnapshot(_contractSymbol: string): Promise<OptionSnapshot> {
    throw createError(ErrorCode.NOT_SUPPORTED, "Options trading is not supported by the eToro provider");
  }

  async getSnapshots(_contractSymbols: string[]): Promise<Record<string, OptionSnapshot>> {
    throw createError(ErrorCode.NOT_SUPPORTED, "Options trading is not supported by the eToro provider");
  }
}

export function createEtoroOptionsProvider(): EtoroOptionsProvider {
  return new EtoroOptionsProvider();
}
