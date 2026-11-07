export type FluxGraphErrorCode =
  | "SCHEMA_VIOLATION"
  | "INVALID_JSON"
  | "CANONICALIZATION_ERROR"
  | "CURRENCY_MISMATCH"
  | "INVALID_AMOUNT"
  | "INVALID_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "AUDIT_CHAIN_BROKEN"
  | "INVALID_SALT"
  | "INVALID_ID";

/** Single error type thrown or returned by FluxGraph. `code` is stable; `message` is for humans. */
export class FluxGraphError extends Error {
  readonly code: FluxGraphErrorCode;
  readonly details: readonly string[];
  constructor(code: FluxGraphErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "FluxGraphError";
    this.code = code;
    this.details = details;
  }
}
