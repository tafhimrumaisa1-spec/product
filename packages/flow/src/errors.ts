/**
 * Every failure FluxFlow can surface has a stable machine-readable code so that
 * FluxShell / FluxLedger can render business-language explanations.
 */
export type FluxFlowErrorCode =
  | 'INVALID_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'INVALID_CONFIG'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_NETWORK'
  | 'WRONG_NETWORK'
  | 'WRONG_MINT'
  | 'WRONG_RECIPIENT'
  | 'WRONG_AGENT'
  | 'MANDATE_NOT_FOUND'
  | 'MANDATE_NOT_ACTIVE'
  | 'MANDATE_NOT_APPROVED'
  | 'MANDATE_EXPIRED'
  | 'DELEGATION_REVOKED'
  | 'DELEGATION_EXPIRED'
  | 'DELEGATION_NOT_STARTED'
  | 'CAP_EXCEEDED'
  | 'INSUFFICIENT_BALANCE'
  | 'REPLAY_DETECTED'
  | 'RPC_TIMEOUT'
  | 'BLOCKHASH_EXPIRED'
  | 'TX_FAILED'
  | 'PROGRAM_REJECTED'
  | 'SETTLEMENT_MISMATCH'
  | 'EVIDENCE_UNAVAILABLE'
  | 'BROWSER_SIGNER_FORBIDDEN'
  | 'NOT_IMPLEMENTED'
  | 'ADAPTER_CONTRACT';

export class FluxFlowError extends Error {
  readonly code: FluxFlowErrorCode;
  /** Non-secret diagnostic context. Never put keys or tokens in here. */
  readonly details: Readonly<Record<string, string>>;

  constructor(code: FluxFlowErrorCode, message: string, details: Record<string, string> = {}) {
    super(message);
    this.name = 'FluxFlowError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isFluxFlowError(e: unknown): e is FluxFlowError {
  return e instanceof FluxFlowError;
}
