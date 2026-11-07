import type { FluxFlowErrorCode } from './errors.js';
import type { ChainReader, ExpectedSettlement, SettlementVerifier, VerificationResult } from './interfaces.js';

/**
 * Verifies settlement from chain evidence (token balance deltas), not from the
 * agent's claim. Replay prevention lives in ReceiptStore; this checks the
 * transaction itself: network, success, mint, recipient, exact amount, payer debit.
 *
 * Exact equality is required. Token-2022 transfer-fee mints would produce a
 * recipient delta smaller than the amount and are therefore flagged.
 */
export function createSettlementVerifier(reader: ChainReader): SettlementVerifier {
  return {
    async verify(expected: ExpectedSettlement): Promise<VerificationResult> {
      const failures: FluxFlowErrorCode[] = [];

      if ((await reader.getNetwork()) !== expected.network) failures.push('WRONG_NETWORK');

      const evidence = await reader.getTransferEvidence(expected.signature);
      if (evidence === null) {
        return { ok: false, failures: [...failures, 'EVIDENCE_UNAVAILABLE'] };
      }
      if (evidence.err !== null && evidence.err !== undefined) failures.push('TX_FAILED');

      const sameMint = evidence.balanceDeltas.filter((d) => d.mint === expected.mint);
      const otherMintMoved = evidence.balanceDeltas.some((d) => d.mint !== expected.mint && d.delta !== 0n);
      if (sameMint.length === 0 || otherMintMoved) failures.push('WRONG_MINT');

      const received = sameMint
        .filter((d) => d.owner === expected.recipient)
        .reduce((sum, d) => sum + d.delta, 0n);
      if (received !== expected.amount) {
        const movedElsewhere = sameMint.some((d) => d.owner !== expected.recipient && d.owner !== expected.delegator && d.delta > 0n);
        failures.push(movedElsewhere || received === 0n ? 'WRONG_RECIPIENT' : 'SETTLEMENT_MISMATCH');
      }

      const debited = sameMint
        .filter((d) => d.owner === expected.delegator)
        .reduce((sum, d) => sum + d.delta, 0n);
      if (debited !== -expected.amount && expected.delegator !== expected.recipient) {
        failures.push('SETTLEMENT_MISMATCH');
      }

      const unique = [...new Set(failures)];
      return { ok: unique.length === 0, failures: unique };
    },
  };
}
