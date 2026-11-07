import type {
  Address,
  Commitment,
  DelegationKind,
  NetworkId,
  TxSignature,
} from './types.js';
import type { FluxFlowErrorCode } from './errors.js';

/* ------------------------------------------------------------------ */
/* WalletConnection                                                    */
/* ------------------------------------------------------------------ */

/**
 * An injected signer. FluxFlow never creates, stores, serialises or logs key
 * material. `signer` is opaque to FluxFlow and is handed only to the SDK
 * adapter (e.g. a Kit TransactionSigner or a Wallet Standard signer).
 *
 * - `delegator`: the treasury/user that grants authority (signs setup + revoke).
 *   May be a browser wallet: the browser only ever holds a wallet-managed signer.
 * - `delegatee`: the autonomous agent that pulls funds. MUST be server-side.
 *   The AI model itself never receives this object.
 */
export interface WalletConnection {
  readonly role: 'delegator' | 'delegatee';
  readonly address: Address;
  readonly network: NetworkId;
  readonly signer: OpaqueSigner;
}

declare const opaqueSignerBrand: unique symbol;
export type OpaqueSigner = { readonly [opaqueSignerBrand]: true };

/* ------------------------------------------------------------------ */
/* MandateRegistryClient (FluxMandate owns the registry; we consume it) */
/* ------------------------------------------------------------------ */

export type MandateStatus = 'active' | 'suspended' | 'revoked' | 'expired';

export interface MandateRecord {
  readonly mandateId: string;
  readonly contractId: string;
  readonly obligationId: string;
  readonly agentId: string;
  readonly network: NetworkId;
  readonly mint: Address;
  readonly delegator: Address;
  readonly delegatee: Address;
  readonly allowedRecipients: readonly Address[];
  /** Hard ceiling for a single payment, base units. */
  readonly perPaymentCap: bigint;
  /** Unix seconds. */
  readonly validFromTs: bigint;
  /** Unix seconds. Non-zero is required: FluxFlow refuses unbounded mandates. */
  readonly expiresAtTs: bigint;
  readonly status: MandateStatus;
  readonly delegation: { readonly kind: DelegationKind; readonly nonce: bigint };
  /** Reference to the human approval recorded by FluxContracts/FluxMandate. Empty means unapproved. */
  readonly humanApprovalRef: string;
}

export interface MandateRegistryClient {
  getMandate(mandateId: string): Promise<MandateRecord | null>;
}

/* ------------------------------------------------------------------ */
/* DelegationClient                                                    */
/* ------------------------------------------------------------------ */

export interface DelegationRef {
  readonly kind: DelegationKind;
  readonly mint: Address;
  readonly delegator: Address;
  readonly delegatee: Address;
  readonly nonce: bigint;
}

export type DelegationState =
  | {
      readonly kind: 'fixed';
      /** Remaining pullable amount (on-chain `amount`). */
      readonly remaining: bigint;
      /** Unix seconds; 0n = no expiry. */
      readonly expiryTs: bigint;
    }
  | {
      readonly kind: 'recurring';
      readonly amountPerPeriod: bigint;
      readonly amountPulledInPeriod: bigint;
      readonly currentPeriodStartTs: bigint;
      readonly periodLengthS: bigint;
      readonly expiryTs: bigint;
    };

export type AllowanceStatus = 'active' | 'expired' | 'not_started' | 'revoked';

export interface RemainingAllowance {
  readonly status: AllowanceStatus;
  /** Advisory, computed client-side. The Solana program is the authority. */
  readonly remaining: bigint;
  readonly expiryTs: bigint;
}

export interface CreateFixedParams {
  readonly mint: Address;
  readonly delegatee: Address;
  readonly nonce: bigint;
  readonly amount: bigint;
  /** Unix seconds. Must be non-zero (FluxFlow policy). */
  readonly expiryTs: bigint;
}

export interface CreateRecurringParams {
  readonly mint: Address;
  readonly delegatee: Address;
  readonly nonce: bigint;
  readonly amountPerPeriod: bigint;
  readonly periodLengthS: bigint;
  /** Unix seconds; 0n starts when the transaction lands. */
  readonly startTs: bigint;
  /** Unix seconds. Must be non-zero (FluxFlow policy). */
  readonly expiryTs: bigint;
}

export interface PullParams extends DelegationRef {
  /** Owner wallet of the receiving token account. */
  readonly recipient: Address;
  readonly amount: bigint;
}

export interface SubmittedTransaction {
  readonly signature: TxSignature;
  /** Present when the adapter can supply it; enables expiry detection. */
  readonly lastValidBlockHeight?: bigint;
}

export interface DelegationClient {
  createFixed(p: CreateFixedParams): Promise<SubmittedTransaction & { delegationAddress: Address }>;
  createRecurring(p: CreateRecurringParams): Promise<SubmittedTransaction & { delegationAddress: Address }>;
  /** Returns null when the delegation account does not exist (revoked or never created). */
  getState(ref: DelegationRef): Promise<DelegationState | null>;
  getRemainingAllowance(ref: DelegationRef, nowTs: bigint): Promise<RemainingAllowance>;
  revoke(ref: DelegationRef): Promise<SubmittedTransaction>;
  /** Delegatee-signed pull against the delegation. */
  pull(p: PullParams): Promise<SubmittedTransaction>;
}

/* ------------------------------------------------------------------ */
/* Chain reads (RPC port)                                              */
/* ------------------------------------------------------------------ */

export interface SignatureStatus {
  readonly confirmationStatus: Commitment;
  /** null when the transaction succeeded. Opaque, never parsed for secrets. */
  readonly err: unknown;
  readonly slot: number;
}

export interface BalanceDelta {
  readonly owner: Address;
  readonly mint: Address;
  /** post - pre, base units. */
  readonly delta: bigint;
}

export interface TransferEvidence {
  readonly signature: TxSignature;
  readonly slot: number;
  readonly err: unknown;
  readonly balanceDeltas: readonly BalanceDelta[];
}

export interface ChainReader {
  getNetwork(): Promise<NetworkId>;
  getTokenBalance(owner: Address, mint: Address): Promise<bigint>;
  getSignatureStatus(signature: TxSignature): Promise<SignatureStatus | null>;
  getBlockHeight(commitment: Commitment): Promise<bigint>;
  getTransferEvidence(signature: TxSignature): Promise<TransferEvidence | null>;
}

/* ------------------------------------------------------------------ */
/* SettlementReceipt, PaymentExecutor, SettlementVerifier              */
/* ------------------------------------------------------------------ */

/**
 * Evidence-complete receipt consumed by FluxLedger and FluxProof.
 * Amounts are decimal strings so the object is JSON-safe.
 * Contains no secrets and no contract content.
 */
export interface SettlementReceipt {
  readonly receiptId: string;
  readonly paymentId: string;
  readonly signature: TxSignature;
  readonly network: NetworkId;
  readonly commitment: Commitment;
  readonly slot: number;
  readonly confirmedAtMs: number;
  readonly mint: Address;
  readonly amount: string;
  readonly recipient: Address;
  readonly delegator: Address;
  readonly delegatee: Address;
  readonly delegationKind: DelegationKind;
  readonly mandateId: string;
  readonly contractId: string;
  readonly obligationId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly humanApprovalRef: string;
  readonly verified: true;
}

export interface PaymentRequest {
  /** Idempotency key. A paymentId may settle at most once. */
  readonly paymentId: string;
  readonly mandateId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly network: NetworkId;
  readonly mint: Address;
  readonly recipient: Address;
  readonly amount: bigint;
}

export interface PaymentExecutor {
  execute(request: PaymentRequest): Promise<SettlementReceipt>;
}

export interface ExpectedSettlement {
  readonly signature: TxSignature;
  readonly network: NetworkId;
  readonly mint: Address;
  readonly recipient: Address;
  readonly delegator: Address;
  readonly amount: bigint;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly failures: readonly FluxFlowErrorCode[];
}

export interface SettlementVerifier {
  verify(expected: ExpectedSettlement): Promise<VerificationResult>;
}
