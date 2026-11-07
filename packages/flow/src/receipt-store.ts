import { FluxFlowError } from './errors.js';
import type { SettlementReceipt } from './interfaces.js';
import type { TxSignature } from './types.js';

/**
 * Duplicate-receipt / replay prevention.
 *
 * Rules (mirroring the "reuse check and consume must be atomic" guidance on
 * solana.com/docs/payments/agentic-payments/mpp and the x402 V2 verification checklist):
 *  - a paymentId can be reserved once;
 *  - a transaction signature can be attached to at most one paymentId;
 *  - a receipt can only be committed for a reserved+submitted payment.
 *
 * Production deployments MUST provide a durable implementation whose `reserve`
 * and `markSubmitted` are atomic across all instances (e.g. unique-key inserts).
 * The in-memory version below is for tests, demos and single-process use only.
 */
export interface ReceiptStore {
  /** Atomically reserve a paymentId. Returns false if it already exists in any state. */
  reserve(paymentId: string): Promise<boolean>;
  /** Atomically bind a signature to a reserved paymentId. Returns false if the signature is already used. */
  markSubmitted(paymentId: string, signature: TxSignature): Promise<boolean>;
  commit(receipt: SettlementReceipt): Promise<void>;
  /** Free a reservation whose transaction definitively did not settle. */
  release(paymentId: string): Promise<void>;
  get(paymentId: string): Promise<SettlementReceipt | null>;
}

type Entry =
  | { state: 'reserved' }
  | { state: 'submitted'; signature: TxSignature }
  | { state: 'committed'; receipt: SettlementReceipt };

export class InMemoryReceiptStore implements ReceiptStore {
  private readonly entries = new Map<string, Entry>();
  private readonly signatures = new Map<TxSignature, string>();

  async reserve(paymentId: string): Promise<boolean> {
    if (this.entries.has(paymentId)) return false;
    this.entries.set(paymentId, { state: 'reserved' });
    return true;
  }

  async markSubmitted(paymentId: string, signature: TxSignature): Promise<boolean> {
    const entry = this.entries.get(paymentId);
    if (entry?.state !== 'reserved') return false;
    if (this.signatures.has(signature)) return false;
    this.signatures.set(signature, paymentId);
    this.entries.set(paymentId, { state: 'submitted', signature });
    return true;
  }

  async commit(receipt: SettlementReceipt): Promise<void> {
    const entry = this.entries.get(receipt.paymentId);
    if (entry?.state !== 'submitted' || entry.signature !== receipt.signature) {
      throw new FluxFlowError('REPLAY_DETECTED', 'Receipt does not match a submitted payment.', {
        paymentId: receipt.paymentId,
      });
    }
    this.entries.set(receipt.paymentId, { state: 'committed', receipt });
  }

  async release(paymentId: string): Promise<void> {
    const entry = this.entries.get(paymentId);
    if (entry === undefined || entry.state === 'committed') return;
    if (entry.state === 'submitted') this.signatures.delete(entry.signature);
    this.entries.delete(paymentId);
  }

  async get(paymentId: string): Promise<SettlementReceipt | null> {
    const entry = this.entries.get(paymentId);
    return entry?.state === 'committed' ? entry.receipt : null;
  }
}
