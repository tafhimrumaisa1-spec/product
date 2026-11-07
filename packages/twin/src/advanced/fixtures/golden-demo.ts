import type { TwinInput } from '../types';

/**
 * SYNTHETIC data for the FluxMandate golden demo. No real company, vendor or money.
 * Amounts are USD cents.
 *
 *  cash          $1,500,000      MRR $150,000      other operating burn $190,000 / month
 *  existing:     office lease $8,000 / month, 24 months from 2026-07
 *  proposed:     "Northwind Compute (synthetic)" 12-month compute-services contract,
 *                $25,000 / month in advance, usage-sensitive with a $40,000 monthly cap,
 *                auto-renews for 12 months at +5%, 2 months' notice.
 */
export function goldenDemoInput(): TwinInput {
  return {
    currency: 'USD',
    minorUnitDecimals: 2,
    startMonth: '2026-12',
    horizonMonths: 24,
    cashBalanceMinor: 150_000_000,
    monthlyRecurringRevenueMinor: 15_000_000,
    existingMonthlyBurnMinor: 19_000_000,
    existingObligations: [
      {
        id: 'obl-office-lease',
        label: 'Office lease (synthetic)',
        counterparty: 'Example Property Co (synthetic)',
        amountMinor: 800_000,
        cadence: 'monthly',
        termStartMonth: '2026-07',
        termMonths: 24,
        paymentTiming: 'advance',
        usageSensitive: false,
        periodicCapMinor: null,
        renewal: null,
        terminationNoticeMonths: 3,
        externalRef: null,
      },
    ],
    proposedObligations: [
      {
        id: 'obl-compute-services',
        label: 'Compute services agreement (synthetic)',
        counterparty: 'Northwind Compute (synthetic)',
        amountMinor: 2_500_000,
        cadence: 'monthly',
        termStartMonth: '2027-01',
        termMonths: 12,
        paymentTiming: 'advance',
        usageSensitive: true,
        periodicCapMinor: 4_000_000,
        renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 500 },
        terminationNoticeMonths: 2,
        externalRef: 'synthetic-contract-001',
      },
    ],
    baseAssumptions: {
      revenueChangeBps: 0,
      usageMultiplierBps: 10_000,
      renewalsEnabled: true,
      customerPaymentDelayMonths: 0,
      delayedRevenueShareBps: 10_000,
    },
    policy: { minimumCashReserveMinor: 15_000_000, minimumRunwayMonths: 12, largePaymentShareBps: 2_500 },
  };
}
