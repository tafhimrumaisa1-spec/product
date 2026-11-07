import { bool, comparableRunwayX100, money, monthLabel, months, monthsX100, text } from './facts';
import type {
  ExplanationFact, FactValue, NormalizedTwinInput, PositionSummary, ScenarioResult,
} from './types';

type Subject = 'before' | 'after';

function runwayFact(s: ScenarioResult, subject: Subject, input: NormalizedTwinInput): ExplanationFact {
  const pos = s[subject];
  const r = pos.runway;
  const rows = s.timeline[subject];
  const depletedRow = r.status === 'depleted' ? rows[r.depletionMonthOffset] : undefined;
  const inputs: Record<string, FactValue> = {
    horizonMonths: months(input.horizonMonths),
    availableCashMinor: money(pos.availableCashMinor),
  };
  if (depletedRow) {
    inputs.depletionMonthOpeningCashMinor = money(depletedRow.openingCashMinor);
    inputs.depletionMonthNetOutflowMinor = money(-depletedRow.netCashFlowMinor);
  }
  return {
    factId: `runway:${s.scenario.id}:${subject}`,
    metric: 'runway',
    scenarioId: s.scenario.id,
    subject,
    phraseKey: r.status === 'depleted' ? 'runway.depleted' : 'runway.funded_through_horizon',
    formula:
      'Simulate monthly cash. Cash is depleted in the first month whose closing cash <= 0 with positive net outflow. ' +
      'runway (hundredths of a month) = 100 * months fully funded + floor(100 * opening cash / net outflow) in the depletion month.',
    inputs,
    result: monthsX100(r.monthsX100),
    components: [],
    relatedObligationIds: [],
    relatedMonths: r.status === 'depleted' ? [r.depletionMonth] : [],
  };
}

function burnFact(s: ScenarioResult, subject: Subject, input: NormalizedTwinInput): ExplanationFact {
  const pos = s[subject];
  return {
    factId: `monthly_net_burn:${s.scenario.id}:${subject}`,
    metric: 'monthly_net_burn',
    scenarioId: s.scenario.id,
    subject,
    phraseKey: 'monthly_net_burn.average',
    formula:
      'average over the horizon of (operating burn + obligation payments - collected revenue), per month, rounded half away from zero. Positive = burning cash.',
    inputs: {
      horizonMonths: months(input.horizonMonths),
      collectedRevenueMinor: money(pos.totals.collectedRevenueMinor),
      operatingBurnMinor: money(pos.totals.operatingBurnMinor),
      obligationPaymentsMinor: money(pos.totals.obligationPaymentsMinor),
    },
    result: money(pos.monthlyNetBurn.averageMinor),
    components: [
      { ref: 'firstMonthMinor', value: money(pos.monthlyNetBurn.firstMonthMinor) },
      { ref: 'peakMinor', value: money(pos.monthlyNetBurn.peakMinor) },
    ],
    relatedObligationIds: [],
    relatedMonths: [pos.monthlyNetBurn.peakMonth],
  };
}

function safeFact(s: ScenarioResult, subject: Subject, input: NormalizedTwinInput): ExplanationFact {
  const pos: PositionSummary = s[subject];
  const b = pos.safeToDeployBinding;
  return {
    factId: `safe_to_deploy:${s.scenario.id}:${subject}`,
    metric: 'safe_to_deploy',
    scenarioId: s.scenario.id,
    subject,
    phraseKey: b.monthOffset === null ? 'safe_to_deploy.limited_by_opening_cash' : 'safe_to_deploy.limited_by_future_low_point',
    formula:
      'max(0, min(opening cash, closing cash of every simulated month) - minimum cash reserve). Spending X now lowers every future balance by X.',
    inputs: {
      availableCashMinor: money(pos.availableCashMinor),
      lowestCashPointMinor: money(b.cashMinor),
      lowestCashPointMonth: monthLabel(b.month),
      reserveMinor: money(input.policy.minimumCashReserveMinor),
    },
    result: money(pos.safeToDeployCapitalMinor),
    components: [],
    relatedObligationIds: [],
    relatedMonths: b.month === null ? [] : [b.month],
  };
}

function minCashFact(s: ScenarioResult, subject: Subject): ExplanationFact {
  const pos = s[subject];
  return {
    factId: `minimum_cash:${s.scenario.id}:${subject}`,
    metric: 'minimum_cash',
    scenarioId: s.scenario.id,
    subject,
    phraseKey: pos.minimumClosingCash.minor < 0 ? 'minimum_cash.negative' : 'minimum_cash.positive',
    formula: 'min over simulated months of closing cash (earliest month on ties). May be negative.',
    inputs: { endingCashMinor: money(pos.endingCashMinor) },
    result: money(pos.minimumClosingCash.minor),
    components: [],
    relatedObligationIds: [],
    relatedMonths: [pos.minimumClosingCash.month],
  };
}

function deltaFact(s: ScenarioResult): ExplanationFact {
  const d = s.deltas;
  return {
    factId: `scenario_delta:${s.scenario.id}:delta`,
    metric: 'scenario_delta',
    scenarioId: s.scenario.id,
    subject: 'delta',
    phraseKey: 'scenario_delta.proposal_effect',
    formula: 'effect of adding the proposed obligations = after - before. Funded runways use the horizon as a lower bound.',
    inputs: {
      runwayBeforeComparableMonthsX100: monthsX100(comparableRunwayX100(s.before.runway)),
      runwayAfterComparableMonthsX100: monthsX100(comparableRunwayX100(s.after.runway)),
      safeToDeployBeforeMinor: money(s.before.safeToDeployCapitalMinor),
      safeToDeployAfterMinor: money(s.after.safeToDeployCapitalMinor),
      monthlyNetBurnBeforeMinor: money(s.before.monthlyNetBurn.averageMinor),
      monthlyNetBurnAfterMinor: money(s.after.monthlyNetBurn.averageMinor),
      runwayChangeIsLowerBound: bool(d.runwayChangeIsLowerBound),
    },
    result: monthsX100(d.runwayChangeMonthsX100),
    components: [
      { ref: 'safeToDeployChangeMinor', value: money(d.safeToDeployChangeMinor) },
      { ref: 'monthlyNetBurnChangeMinor', value: money(d.monthlyNetBurnChangeMinor) },
      { ref: 'endingCashChangeMinor', value: money(d.endingCashChangeMinor) },
    ],
    relatedObligationIds: [],
    relatedMonths: [],
  };
}

export function buildExplanations(input: NormalizedTwinInput, results: readonly ScenarioResult[]): ExplanationFact[] {
  const out: ExplanationFact[] = [];
  const base = results[0] as ScenarioResult;

  out.push({
    factId: 'available_cash:all:input',
    metric: 'available_cash',
    scenarioId: null,
    subject: 'input',
    phraseKey: 'available_cash.opening_balance',
    formula: 'available cash = cash balance supplied at the start month.',
    inputs: { cashBalanceMinor: money(input.cashBalanceMinor), startMonth: monthLabel(input.startMonth) },
    result: money(base.after.availableCashMinor),
    components: [],
    relatedObligationIds: [],
    relatedMonths: [input.startMonth],
  });

  for (const subject of ['before', 'after'] as const) {
    const c = base[subject].contractuallyCommittedCapital;
    out.push({
      factId: `committed_capital:all:${subject}`,
      metric: 'committed_capital',
      scenarioId: null,
      subject,
      phraseKey: 'committed_capital.remaining_initial_terms',
      formula:
        'sum of every remaining initial-term payment (on or after the start month) at its contract base amount. Excludes renewals and usage overage.',
      inputs: {
        startMonth: monthLabel(input.startMonth),
        horizonMonths: months(input.horizonMonths),
        withinHorizonMinor: money(c.withinHorizonMinor),
        beyondHorizonMinor: money(c.beyondHorizonMinor),
        existingMinor: money(c.existingMinor),
        proposedMinor: money(c.proposedMinor),
      },
      result: money(c.totalMinor),
      components: c.items.map((i) => ({ ref: i.obligationId, value: money(i.totalMinor) })),
      relatedObligationIds: c.items.map((i) => i.obligationId),
      relatedMonths: [],
    });
  }

  for (const s of results) {
    for (const subject of ['before', 'after'] as const) {
      out.push(burnFact(s, subject, input), runwayFact(s, subject, input), safeFact(s, subject, input), minCashFact(s, subject));
    }
    out.push(deltaFact(s));
    s.riskFlags.forEach((f, i) => {
      out.push({
        factId: `risk_flag:${s.scenario.id}:${f.code}:${f.relatedObligationIds[0] ?? '-'}:${i}`,
        metric: 'risk_flag',
        scenarioId: s.scenario.id,
        subject: 'after',
        phraseKey: `risk_flag.${f.code}`,
        formula: 'deterministic rule; see risk flag code',
        inputs: { ...f.facts, severity: text(f.severity) },
        result: text(f.code),
        components: [],
        relatedObligationIds: f.relatedObligationIds,
        relatedMonths: f.relatedMonths,
      });
    });
  }
  return out;
}
