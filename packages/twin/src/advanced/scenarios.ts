import type { NormalizedTwinInput, ResolvedScenario, ScenarioAssumptions } from './types';

export const DEFAULT_BASE_ASSUMPTIONS: ScenarioAssumptions = Object.freeze({
  revenueChangeBps: 0,
  usageMultiplierBps: 10_000,
  renewalsEnabled: true,
  customerPaymentDelayMonths: 0,
  delayedRevenueShareBps: 10_000,
});

/**
 * Preset scenarios. Each preset OVERRIDES specific fields of the base assumptions
 * (it does not stack on top of them), and the full resolved assumptions are echoed
 * in every ScenarioResult.
 *
 *  base                       : baseAssumptions as supplied
 *  revenue_down               : revenueChangeBps = presetParameters.downsideRevenueBps (default -20%)
 *  revenue_up                 : revenueChangeBps = presetParameters.upsideRevenueBps   (default +20%)
 *  higher_compute_usage       : usageMultiplierBps = highUsageMultiplierBps            (default 1.5x)
 *  renewal_off                : renewalsEnabled = false
 *  delayed_customer_payments  : delay = delayMonths (default 2), 100% of revenue delayed
 *  combined_downside          : revenue_down + higher_compute_usage + delayed payments + renewals ON
 */
export function buildScenarios(input: NormalizedTwinInput): ResolvedScenario[] {
  const b = input.baseAssumptions;
  const p = input.presetParameters;
  const withBase = (o: Partial<ScenarioAssumptions>): ScenarioAssumptions => ({ ...b, ...o });
  const presets: ResolvedScenario[] = [
    { id: 'base', label: 'Base', description: 'Supplied base assumptions.', assumptions: { ...b } },
    {
      id: 'revenue_down',
      label: 'Revenue down',
      description: 'Monthly recurring revenue falls by the downside percentage.',
      assumptions: withBase({ revenueChangeBps: p.downsideRevenueBps }),
    },
    {
      id: 'revenue_up',
      label: 'Revenue up',
      description: 'Monthly recurring revenue rises by the upside percentage.',
      assumptions: withBase({ revenueChangeBps: p.upsideRevenueBps }),
    },
    {
      id: 'higher_compute_usage',
      label: 'Higher compute usage',
      description: 'Usage-sensitive payments scale up, limited by each contract\u2019s periodic cap.',
      assumptions: withBase({ usageMultiplierBps: p.highUsageMultiplierBps }),
    },
    {
      id: 'renewal_off',
      label: 'Contract renewal off',
      description: 'Auto-renewing contracts end at the close of their initial term.',
      assumptions: withBase({ renewalsEnabled: false }),
    },
    {
      id: 'delayed_customer_payments',
      label: 'Delayed customer payments',
      description: 'All customer revenue is collected later than booked.',
      assumptions: withBase({ customerPaymentDelayMonths: p.delayMonths, delayedRevenueShareBps: 10_000 }),
    },
    {
      id: 'combined_downside',
      label: 'Combined downside',
      description: 'Lower revenue, higher compute usage, delayed collections and renewals on, together.',
      assumptions: withBase({
        revenueChangeBps: p.downsideRevenueBps,
        usageMultiplierBps: p.highUsageMultiplierBps,
        customerPaymentDelayMonths: p.delayMonths,
        delayedRevenueShareBps: 10_000,
        renewalsEnabled: true,
      }),
    },
  ];
  const extras: ResolvedScenario[] = input.extraScenarios.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    assumptions: { ...s.assumptions },
  }));
  return [...presets, ...extras];
}
