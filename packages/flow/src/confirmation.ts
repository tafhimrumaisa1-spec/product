import type { FluxFlowConfig } from './config.js';
import { FluxFlowError, isFluxFlowError } from './errors.js';
import type { ChainReader, SignatureStatus, SubmittedTransaction } from './interfaces.js';
import type { Clock, Commitment } from './types.js';

const RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 };

/**
 * Poll until the signature reaches the configured commitment.
 *
 * Behaviour follows solana.com/docs/core/transactions/confirmation:
 *  - a transaction whose blockhash expired can never land: once `getBlockHeight`
 *    exceeds `lastValidBlockHeight` with no status, fail with BLOCKHASH_EXPIRED
 *    (safe to retry with a new payment attempt);
 *  - an on-chain error => TX_FAILED (funds did not move);
 *  - deadline reached with no answer => RPC_TIMEOUT (outcome UNKNOWN, do not release).
 * RPC errors are treated as transient until the deadline.
 */
export async function confirmTransaction(
  reader: ChainReader,
  config: Pick<FluxFlowConfig, 'commitment' | 'confirmTimeoutMs' | 'pollIntervalMs'>,
  tx: SubmittedTransaction,
  clock: Clock,
): Promise<SignatureStatus> {
  const deadline = clock.nowMs() + config.confirmTimeoutMs;
  let lastRpcFailure = false;

  for (;;) {
    try {
      const status = await reader.getSignatureStatus(tx.signature);
      lastRpcFailure = false;
      if (status !== null) {
        if (status.err !== null && status.err !== undefined) {
          throw new FluxFlowError('TX_FAILED', 'Transaction was processed but failed on-chain.', {
            signature: tx.signature,
          });
        }
        if (RANK[status.confirmationStatus] >= RANK[config.commitment]) return status;
      } else if (tx.lastValidBlockHeight !== undefined) {
        const height = await reader.getBlockHeight('confirmed');
        if (height > tx.lastValidBlockHeight) {
          // One last look: it may have landed between the two calls.
          const final = await reader.getSignatureStatus(tx.signature);
          if (final === null) {
            throw new FluxFlowError('BLOCKHASH_EXPIRED', 'Blockhash expired before the transaction landed.', {
              signature: tx.signature,
            });
          }
        }
      }
    } catch (e) {
      // Verdicts (TX_FAILED, BLOCKHASH_EXPIRED) are final; RPC failures are transient until the deadline.
      if (isFluxFlowError(e) && e.code !== 'RPC_TIMEOUT') throw e;
      lastRpcFailure = true;
    }

    if (clock.nowMs() + config.pollIntervalMs > deadline) {
      throw new FluxFlowError(
        'RPC_TIMEOUT',
        lastRpcFailure
          ? 'RPC unavailable before the confirmation deadline; settlement outcome is unknown.'
          : 'Confirmation deadline reached; settlement outcome is unknown.',
        { signature: tx.signature },
      );
    }
    await clock.sleep(config.pollIntervalMs);
  }
}
