export const ErrorCode = {
  INVALID_INPUT: "INVALID_INPUT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  POLICY_VIOLATION: "POLICY_VIOLATION",
  KILL_SWITCH_ACTIVE: "KILL_SWITCH_ACTIVE",
  INVALID_APPROVAL_TOKEN: "INVALID_APPROVAL_TOKEN",
  EXPIRED_APPROVAL_TOKEN: "EXPIRED_APPROVAL_TOKEN",
  MARKET_CLOSED: "MARKET_CLOSED",
  INSUFFICIENT_BUYING_POWER: "INSUFFICIENT_BUYING_POWER",
  FEATURE_DISABLED: "FEATURE_DISABLED",
  NOT_SUPPORTED: "NOT_SUPPORTED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ToolError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class MakoraError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "MakoraError";
  }

  toToolError(): ToolError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function createError(code: ErrorCode, message: string, details?: unknown): MakoraError {
  return new MakoraError(code, message, details);
}
