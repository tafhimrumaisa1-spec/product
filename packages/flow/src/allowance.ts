import type { DelegationState, RemainingAllowance } from './interfaces.js';

/**
 * Pure, advisory remaining-allowance calculation.
 *
 * Sources: solana.com/docs/payments/subscriptions/{fixed,recurring}-delegation and the
 * program's account layouts (solana-foundation/subscriptions docs/001-program-architecture.md):
 *  - fixed: on-chain `amount` is the remaining pullable amount.
 *  - recurring: `amount_per_period` minus `amount_pulled_in_period`; a new period resets usage.
 *  - `expiry_ts == 0` means no expiry. FluxFlow policy refuses to CREATE such delegations,
 *    but still reads them correctly.
 *
 * The exact on-chain reset rule is not spelled out in the docs we could fetch, so this is a
 * pre-flight guard only. The Solana program remains the enforcement point.
 */
export function computeRemaining(state: DelegationState | null, nowTs: bigint): RemainingAllowance {
  if (state === null) {
    return { status: 'revoked', remaining: 0n, expiryTs: 0n };
  }
  if (state.expiryTs !== 0n && nowTs >= state.expiryTs) {
    return { status: 'expired', remaining: 0n, expiryTs: state.expiryTs };
  }
  if (state.kind === 'fixed') {
    return { status: 'active', remaining: state.remaining, expiryTs: state.expiryTs };
  }
  if (nowTs < state.currentPeriodStartTs) {
    return { status: 'not_started', remaining: 0n, expiryTs: state.expiryTs };
  }
  const periodEnded = nowTs >= state.currentPeriodStartTs + state.periodLengthS;
  const pulled = periodEnded ? 0n : state.amountPulledInPeriod;
  const remaining = state.amountPerPeriod > pulled ? state.amountPerPeriod - pulled : 0n;
  return { status: 'active', remaining, expiryTs: state.expiryTs };
}
