import { buildExplanations } from './explain';
import { comparableRunwayX100 } from './facts';
import { MoneyError, sub } from './money';
import { parseMonth } from './months';
import { buildRiskFlags, severityRank } from './risk';
import { buildScenarios } from './scenarios';
import { simulate } from './simulate';
import { computeCommitted, summarize } from './summary';
import { validateTwinInput } from './validate';
import {
  ENGINE_VERSION, SCHEMA_VERSION,
  type ComparisonRow, type NormalizedObligation, type NormalizedTwinInput, type ObligationOrigin,
  type ResolvedScenario, type ScenarioComparison, type ScenarioResult, type Severity, type TwinOutput, type TwinResult,
} from './types';

type Tagged = { ob: NormalizedObligation; origin: ObligationOrigin };

function runScenario(input: NormalizedTwinInput, scenario: ResolvedScenario): ScenarioResult {
  const startIndex = parseMonth(input.startMonth) as number;
  const existing: Tagged[] = input.existingObligations.map((ob) => ({ ob, origin: 'existing' }));
  const proposed: Tagged[] = input.proposedObligations.map((ob) => ({ ob, origin: 'proposed' }));
  const common = {
    startIndex,
    horizonMonths: input.horizonMonths,
    openingCashMinor: input.cashBalanceMinor,
    monthlyRecurringRevenueMinor: input.monthlyRecurringRevenueMinor,
    existingMonthlyBurnMinor: input.existingMonthlyBurnMinor,
    assumptions: scenario.assumptions,
  };
  const simBefore = simulate({ ...common, obligations: existing });
  const simAfter = simulate({ ...common, obligations: [...existing, ...proposed] });

  const summaryBase = {
    openingCashMinor: input.cashBalanceMinor,
    reserveMinor: input.policy.minimumCashReserveMinor,
    horizonMonths: input.horizonMonths,
  };
  const before = summarize({ ...summaryBase, rows: simBefore.rows, committed: computeCommitted(existing, startIndex, input.horizonMonths) });
  const after = summarize({ ...summaryBase, rows: simAfter.rows, committed: computeCommitted([...existing, ...proposed], startIndex, input.horizonMonths) });

  const rb = comparableRunwayX100(before.runway);
  const ra = comparableRunwayX100(after.runway);
  return {
    scenario,
    before,
    after,
    deltas: {
      runwayChangeMonthsX100: ra - rb,
      runwayChangeIsLowerBound: before.runway.status === 'funded_through_horizon' || after.runway.status === 'funded_through_horizon',
      safeToDeployChangeMinor: sub(after.safeToDeployCapitalMinor, before.safeToDeployCapitalMinor),
      monthlyNetBurnChangeMinor: sub(after.monthlyNetBurn.averageMinor, before.monthlyNetBurn.averageMinor),
      endingCashChangeMinor: sub(after.endingCashMinor, before.endingCashMinor),
    },
    timeline: { before: simBefore.rows, after: simAfter.rows },
    obligationTimeline: simAfter.events,
    riskFlags: buildRiskFlags({ input, scenario, before, after, events: simAfter.events }),
  };
}

export function buildComparison(results: readonly ScenarioResult[]): ScenarioComparison {
  const base = results[0] as ScenarioResult;
  const rows: ComparisonRow[] = results.map((s) => {
    const cmp = comparableRunwayX100(s.after.runway);
    const top: Severity | null = s.riskFlags.reduce<Severity | null>(
      (m, f) => (m === null || severityRank(f.severity) > severityRank(m) ? f.severity : m),
      null,
    );
    return {
      scenarioId: s.scenario.id,
      label: s.scenario.label,
      runwayBefore: s.before.runway,
      runwayAfter: s.after.runway,
      runwayAfterComparableMonthsX100: cmp,
      safeToDeployAfterMinor: s.after.safeToDeployCapitalMinor,
      minimumClosingCashAfterMinor: s.after.minimumClosingCash.minor,
      endingCashAfterMinor: s.after.endingCashMinor,
      monthlyNetBurnAfterMinor: s.after.monthlyNetBurn.averageMinor,
      highestSeverity: top,
      riskFlagCodes: [...new Set(s.riskFlags.map((f) => f.code))],
      vsBase: {
        runwayAfterComparableMonthsX100: cmp - comparableRunwayX100(base.after.runway),
        safeToDeployAfterMinor: sub(s.after.safeToDeployCapitalMinor, base.after.safeToDeployCapitalMinor),
        minimumClosingCashAfterMinor: sub(s.after.minimumClosingCash.minor, base.after.minimumClosingCash.minor),
        endingCashAfterMinor: sub(s.after.endingCashMinor, base.after.endingCashMinor),
        monthlyNetBurnAfterMinor: sub(s.after.monthlyNetBurn.averageMinor, base.after.monthlyNetBurn.averageMinor),
      },
    };
  });
  let worst = rows[0] as ComparisonRow;
  let best = rows[0] as ComparisonRow;
  for (const r of rows) {
    const worse =
      r.minimumClosingCashAfterMinor < worst.minimumClosingCashAfterMinor ||
      (r.minimumClosingCashAfterMinor === worst.minimumClosingCashAfterMinor &&
        r.runwayAfterComparableMonthsX100 < worst.runwayAfterComparableMonthsX100);
    if (worse) worst = r;
    const better =
      r.minimumClosingCashAfterMinor > best.minimumClosingCashAfterMinor ||
      (r.minimumClosingCashAfterMinor === best.minimumClosingCashAfterMinor &&
        r.runwayAfterComparableMonthsX100 > best.runwayAfterComparableMonthsX100);
    if (better) best = r;
  }
  return {
    rows,
    worstCaseScenarioId: worst.scenarioId,
    bestCaseScenarioId: best.scenarioId,
    conservativeSafeToDeployMinor: Math.min(...rows.map((r) => r.safeToDeployAfterMinor)),
  };
}

/** Compute everything from an ALREADY VALIDATED input. May throw MoneyError on overflow. */
export function computeTwin(input: NormalizedTwinInput): TwinOutput {
  const scenarios = buildScenarios(input).map((s) => runScenario(input, s));
  const base = scenarios[0] as ScenarioResult;
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    currency: input.currency,
    minorUnitDecimals: input.minorUnitDecimals,
    startMonth: input.startMonth,
    horizonMonths: input.horizonMonths,
    assumptionsUsed: input,
    headline: {
      scenarioId: 'base',
      availableCashMinor: base.after.availableCashMinor,
      contractuallyCommittedCapitalMinor: base.after.contractuallyCommittedCapital.totalMinor,
      safeToDeployCapitalMinor: base.after.safeToDeployCapitalMinor,
      monthlyNetBurnMinor: base.after.monthlyNetBurn.averageMinor,
      runwayBefore: base.before.runway,
      runwayAfter: base.after.runway,
      riskFlags: base.riskFlags,
    },
    scenarios,
    comparison: buildComparison(scenarios),
    explanations: buildExplanations(input, scenarios),
  };
}

/**
 * Main entry point. Pure and synchronous. Never throws for bad input or overflow:
 * returns `{ ok: false, errors }` instead.
 */
export function runTwin(raw: unknown): TwinResult {
  const v = validateTwinInput(raw);
  if (!v.ok) return { ok: false, errors: v.errors };
  try {
    return { ok: true, output: computeTwin(v.value) };
  } catch (e) {
    if (e instanceof MoneyError) {
      return {
        ok: false,
        errors: [{ code: 'ARITHMETIC_OVERFLOW', path: '', message: `Inputs are too large to compute exactly: ${e.message}` }],
      };
    }
    throw e;
  }
}
