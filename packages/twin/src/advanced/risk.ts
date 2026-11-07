import {
  bool, bps, comparableRunwayX100, count, formatMonthsX100, money, monthLabel, months, monthsX100, text,
} from './facts';
import { exceedsShare, sum } from './money';
import { formatMonth, parseMonth } from './months';
import { nextRenewalStart } from './schedule';
import type {
  FactValue, NormalizedObligation, NormalizedTwinInput, PaymentEvent, PositionSummary,
  ResolvedScenario, RiskFlag, RiskFlagCode, Severity,
} from './types';

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };
export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

export interface RiskContext {
  input: NormalizedTwinInput;
  scenario: ResolvedScenario;
  before: PositionSummary;
  after: PositionSummary;
  /** Events of the "after" run (existing + proposed). */
  events: readonly PaymentEvent[];
}

export function buildRiskFlags(ctx: RiskContext): RiskFlag[] {
  const { input, scenario, before, after, events } = ctx;
  const flags: RiskFlag[] = [];
  const startIdx = parseMonth(input.startMonth) as number;
  const endIdx = startIdx + input.horizonMonths;
  const hasProposals = input.proposedObligations.length > 0;
  const push = (
    code: RiskFlagCode, severity: Severity, summary: string,
    facts: Record<string, FactValue>, ids: string[] = [], monthsRel: string[] = [],
  ): void => {
    flags.push({ code, severity, scenarioId: scenario.id, summary, facts, relatedObligationIds: ids, relatedMonths: monthsRel });
  };

  const rAfter = after.runway;
  const rBefore = before.runway;

  if (rAfter.status === 'depleted') {
    push(
      'CASH_DEPLETED_WITHIN_HORIZON', 'critical',
      `Cash is depleted in ${rAfter.depletionMonth} (runway ${formatMonthsX100(rAfter.monthsX100)} months).`,
      {
        runwayMonthsX100: monthsX100(rAfter.monthsX100),
        depletionMonth: monthLabel(rAfter.depletionMonth),
        alreadyDepletedBeforeProposal: bool(rBefore.status === 'depleted'),
      },
      [], [rAfter.depletionMonth],
    );
    if (rAfter.monthsX100 < input.policy.minimumRunwayMonths * 100) {
      push(
        'RUNWAY_BELOW_POLICY_MINIMUM', 'warning',
        `Runway ${formatMonthsX100(rAfter.monthsX100)} months is below the policy minimum of ${input.policy.minimumRunwayMonths}.`,
        { runwayMonthsX100: monthsX100(rAfter.monthsX100), policyMinimumRunwayMonths: months(input.policy.minimumRunwayMonths) },
      );
    }
  } else if (input.horizonMonths < input.policy.minimumRunwayMonths) {
    push(
      'RUNWAY_NOT_VERIFIABLE_WITHIN_HORIZON', 'info',
      `The ${input.horizonMonths}-month horizon is shorter than the ${input.policy.minimumRunwayMonths}-month policy runway, so the policy cannot be verified.`,
      { horizonMonths: months(input.horizonMonths), policyMinimumRunwayMonths: months(input.policy.minimumRunwayMonths) },
    );
  }

  if (input.policy.minimumCashReserveMinor > 0 && after.minimumClosingCash.minor < input.policy.minimumCashReserveMinor) {
    push(
      'RESERVE_BREACHED', 'warning',
      `Cash falls to ${after.minimumClosingCash.minor} minor units in ${after.minimumClosingCash.month}, below the reserve of ${input.policy.minimumCashReserveMinor}.`,
      {
        minimumClosingCashMinor: money(after.minimumClosingCash.minor),
        reserveMinor: money(input.policy.minimumCashReserveMinor),
        alreadyBreachedBeforeProposal: bool(before.minimumClosingCash.minor < input.policy.minimumCashReserveMinor),
      },
      [], [after.minimumClosingCash.month],
    );
  }

  if (!hasProposals) {
    push('NO_PROPOSED_OBLIGATIONS', 'info', 'No proposed obligations were supplied; before and after are identical.', {
      proposedObligationCount: count(0),
    });
  } else {
    if (before.safeToDeployCapitalMinor > 0 && after.safeToDeployCapitalMinor === 0) {
      push(
        'PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL', 'warning',
        'The proposed obligations use up all safe-to-deploy capital.',
        { safeToDeployBeforeMinor: money(before.safeToDeployCapitalMinor), safeToDeployAfterMinor: money(0) },
        input.proposedObligations.map((o) => o.id),
      );
    }
    const delta = comparableRunwayX100(rAfter) - comparableRunwayX100(rBefore);
    if (delta < 0) {
      const isBound = rAfter.status === 'funded_through_horizon' || rBefore.status === 'funded_through_horizon';
      push(
        'RUNWAY_REDUCED_BY_PROPOSAL', 'info',
        `The proposal shortens runway by ${isBound ? 'at least ' : ''}${formatMonthsX100(-delta)} months.`,
        {
          runwayChangeMonthsX100: monthsX100(delta),
          isLowerBound: bool(isBound),
        },
        input.proposedObligations.map((o) => o.id),
      );
    }
    // large single payments (proposed only), once per obligation using its largest payment
    for (const ob of input.proposedObligations) {
      const mine = events.filter((e) => e.origin === 'proposed' && e.obligationId === ob.id);
      if (mine.length === 0) continue;
      const biggest = mine.reduce((m, e) => (e.amountMinor > m.amountMinor ? e : m));
      if (exceedsShare(biggest.amountMinor, after.availableCashMinor, input.policy.largePaymentShareBps)) {
        push(
          'LARGE_SINGLE_PAYMENT', 'warning',
          `A single payment of ${biggest.amountMinor} minor units in ${biggest.month} exceeds ${input.policy.largePaymentShareBps / 100}% of available cash.`,
          {
            paymentMinor: money(biggest.amountMinor),
            availableCashMinor: money(after.availableCashMinor),
            thresholdBps: bps(input.policy.largePaymentShareBps),
          },
          [ob.id], [biggest.month],
        );
      }
    }
    const beyond = after.contractuallyCommittedCapital.items.filter((i) => i.origin === 'proposed' && i.beyondHorizonMinor > 0);
    if (beyond.length > 0) {
      push(
        'COMMITMENT_EXTENDS_BEYOND_HORIZON', 'info',
        'Some proposed commitments extend past the simulated horizon; their later payments are not in the runway figures.',
        { beyondHorizonMinor: money(sum(beyond.map((i) => i.beyondHorizonMinor))), obligationCount: count(beyond.length) },
        beyond.map((i) => i.obligationId),
      );
    }
  }

  // auto-renewals (existing + proposed)
  if (scenario.assumptions.renewalsEnabled) {
    const all: NormalizedObligation[] = [...input.existingObligations, ...input.proposedObligations];
    for (const ob of all) {
      const r = nextRenewalStart(ob, startIdx);
      if (r === null || r >= endIdx) continue;
      const deadline = r - ob.terminationNoticeMonths;
      push(
        'AUTO_RENEWAL_IN_HORIZON', 'warning',
        `${ob.id} auto-renews in ${formatMonth(r)}; notice must be given by ${formatMonth(deadline)}.`,
        {
          renewalMonth: monthLabel(formatMonth(r)),
          noticeDeadlineMonth: monthLabel(formatMonth(deadline)),
          noticeMonths: months(ob.terminationNoticeMonths),
        },
        [ob.id], [formatMonth(r)],
      );
      if (deadline < startIdx) {
        push(
          'RENEWAL_NOTICE_WINDOW_PASSED', 'warning',
          `The notice deadline (${formatMonth(deadline)}) for ${ob.id} is before the start month; renewal can no longer be avoided by notice.`,
          { noticeDeadlineMonth: monthLabel(formatMonth(deadline)), startMonth: monthLabel(input.startMonth) },
          [ob.id], [formatMonth(deadline)],
        );
      }
    }
  }

  const capped = events.filter((e) => e.capped);
  if (capped.length > 0) {
    const ids = [...new Set(capped.map((e) => e.obligationId))].sort();
    push(
      'USAGE_CAP_REACHED', 'info',
      `The contractual periodic cap limits ${capped.length} payment(s) in this scenario.`,
      { cappedPaymentCount: count(capped.length), usageMultiplierBps: bps(scenario.assumptions.usageMultiplierBps), cappedScope: text(ids.join(',')) },
      ids, [...new Set(capped.map((e) => e.month))],
    );
  }

  flags.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      ((a.relatedObligationIds[0] ?? '') < (b.relatedObligationIds[0] ?? '') ? -1 : (a.relatedObligationIds[0] ?? '') > (b.relatedObligationIds[0] ?? '') ? 1 : 0),
  );
  return flags;
}
