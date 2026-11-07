import type { FluxFlowConfig } from './config.js';
import { confirmTransaction } from './confirmation.js';
import { FluxFlowError, isFluxFlowError } from './errors.js';
import type {
  ChainReader,
  DelegationClient,
  MandateRegistryClient,
  PaymentExecutor,
  PaymentRequest,
  SettlementReceipt,
  SettlementVerifier,
  WalletConnection,
} from './interfaces.js';
import type { ReceiptStore } from './receipt-store.js';
import { unixSeconds, type Clock, systemClock } from './types.js';
import {
  validateAllowance,
  validateMandate,
  validateMint,
  validateNetwork,
  validateRecipient,
  validateRequestShape,
} from './validation.js';

export interface PaymentExecutorDeps {
  readonly config: FluxFlowConfig;
  readonly registry: MandateRegistryClient;
  readonly delegation: DelegationClient;
  readonly chain: ChainReader;
  readonly store: ReceiptStore;
  readonly verifier: SettlementVerifier;
  /** The agent's delegatee wallet. Must be server-side. */
  readonly agentWallet: WalletConnection;
  readonly clock?: Clock;
  /**
   * Set true ONLY for mock/UI-development environments where no real signer exists.
   * Real executors refuse to run in a browser runtime.
   */
  readonly allowBrowserRuntime?: boolean;
}

/** Codes after which the transaction provably did not settle, so the paymentId may be retried. */
const SAFE_TO_RELEASE = new Set(['BLOCKHASH_EXPIRED', 'TX_FAILED', 'PROGRAM_REJECTED']);

function isBrowserRuntime(): boolean {
  return typeof (globalThis as { window?: unknown }).window !== 'undefined';
}

/**
 * Controlled delegated SPL-token transfer. Order of operations:
 *   shape -> reserve paymentId -> mandate -> network -> mint -> recipient -> allowance
 *   -> balance -> pull -> bind signature -> confirm -> verify on-chain evidence -> receipt.
 * Every check before `pull` is a pre-flight guard; the Subscriptions program remains the
 * enforcement point ("Solana enforces").
 */
export function createPaymentExecutor(deps: PaymentExecutorDeps): PaymentExecutor {
  if (deps.agentWallet.role !== 'delegatee') {
    throw new FluxFlowError('INVALID_CONFIG', 'agentWallet must have role "delegatee".');
  }
  if (deps.agentWallet.network !== deps.config.network) {
    throw new FluxFlowError('WRONG_NETWORK', 'agentWallet network differs from configuration.');
  }
  if (isBrowserRuntime() && deps.allowBrowserRuntime !== true) {
    throw new FluxFlowError('BROWSER_SIGNER_FORBIDDEN', 'The agent execution path must run server-side only.');
  }
  const clock = deps.clock ?? systemClock;

  return {
    async execute(req: PaymentRequest): Promise<SettlementReceipt> {
      validateRequestShape(req);

      if (!(await deps.store.reserve(req.paymentId))) {
        throw new FluxFlowError('REPLAY_DETECTED', 'This paymentId has already been used.', { paymentId: req.paymentId });
      }

      let submitted = false;
      let pullAttempted = false;
      try {
        const mandate = await deps.registry.getMandate(req.mandateId);
        if (mandate === null) {
          throw new FluxFlowError('MANDATE_NOT_FOUND', 'No such mandate.', { mandateId: req.mandateId });
        }

        const nowTs = unixSeconds(clock);
        const chainNetwork = await deps.chain.getNetwork();
        validateNetwork(deps.config, req.network, mandate, chainNetwork);
        validateMandate(mandate, req, nowTs, deps.agentWallet.address);
        validateMint(deps.config, mandate, req);
        validateRecipient(mandate, req);

        const ref = {
          kind: mandate.delegation.kind,
          mint: mandate.mint,
          delegator: mandate.delegator,
          delegatee: mandate.delegatee,
          nonce: mandate.delegation.nonce,
        } as const;

        validateAllowance(await deps.delegation.getRemainingAllowance(ref, nowTs), req.amount);

        const balance = await deps.chain.getTokenBalance(mandate.delegator, mandate.mint);
        if (balance < req.amount) {
          throw new FluxFlowError('INSUFFICIENT_BALANCE', 'Delegator balance is below the payment amount.', {
            balance: balance.toString(),
            amount: req.amount.toString(),
          });
        }

        pullAttempted = true;
        const tx = await deps.delegation.pull({ ...ref, recipient: req.recipient, amount: req.amount });

        if (!(await deps.store.markSubmitted(req.paymentId, tx.signature))) {
          throw new FluxFlowError('REPLAY_DETECTED', 'Transaction signature was already used.', { signature: tx.signature });
        }
        submitted = true;

        const status = await confirmTransaction(deps.chain, deps.config, tx, clock);

        const verification = await deps.verifier.verify({
          signature: tx.signature,
          network: deps.config.network,
          mint: mandate.mint,
          recipient: req.recipient,
          delegator: mandate.delegator,
          amount: req.amount,
        });
        if (!verification.ok) {
          // Funds may have moved unexpectedly: keep the reservation so it cannot be retried blindly.
          throw new FluxFlowError('SETTLEMENT_MISMATCH', 'On-chain evidence does not match the request.', {
            signature: tx.signature,
            failures: verification.failures.join(','),
          });
        }

        const receipt: SettlementReceipt = {
          receiptId: `rcpt:${req.paymentId}`,
          paymentId: req.paymentId,
          signature: tx.signature,
          network: deps.config.network,
          commitment: status.confirmationStatus,
          slot: status.slot,
          confirmedAtMs: clock.nowMs(),
          mint: mandate.mint,
          amount: req.amount.toString(),
          recipient: req.recipient,
          delegator: mandate.delegator,
          delegatee: mandate.delegatee,
          delegationKind: mandate.delegation.kind,
          mandateId: mandate.mandateId,
          contractId: mandate.contractId,
          obligationId: mandate.obligationId,
          agentId: req.agentId,
          taskId: req.taskId,
          humanApprovalRef: mandate.humanApprovalRef,
          verified: true,
        };
        await deps.store.commit(receipt);
        return receipt;
      } catch (e) {
        // Release only when the transaction provably did not (and cannot) settle.
        //  - nothing was sent yet                       -> safe
        //  - pull() threw: only a program/simulation rejection is definitive; a timeout
        //    or unknown error may hide a transaction that landed, so the key stays reserved
        //  - signature known: only expiry / on-chain failure are definitive
        const code = isFluxFlowError(e) ? e.code : undefined;
        let definitelyNotSettled: boolean;
        if (!pullAttempted) definitelyNotSettled = true;
        else if (!submitted) definitelyNotSettled = code === 'PROGRAM_REJECTED';
        else definitelyNotSettled = code !== undefined && SAFE_TO_RELEASE.has(code);
        if (definitelyNotSettled) await deps.store.release(req.paymentId);
        throw e;
      }
    },
  };
}
