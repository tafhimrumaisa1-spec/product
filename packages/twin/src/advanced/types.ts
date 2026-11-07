/**
 * FluxTwin public types.
 *
 * Conventions
 *  - Money is ALWAYS an integer count of minor units (e.g. cents) held in a JS
 *    `number` that must satisfy Number.isSafeInteger. Field names end in `Minor`.
 *  - Percentages are integer basis points (bps). 10_000 bps = 100%.
 *  - Months are "YYYY-MM" strings. No time zones, no clocks, no `Date`.
 *  - Sign convention for burn: positive = cash leaving the company.
 */

export type MinorUnits = number;
export type Bps = number;
export type MonthLabel = string;

export const SCHEMA_VERSION = 'fluxtwin.output.v1' as const;
export const ENGINE_VERSION = '1.0.0' as const;

export type Cadence = 'one_time' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type PaymentTiming = 'advance' | 'arrears';
export type ObligationOrigin = 'existing' | 'proposed';
export type Severity = 'info' | 'warning' | 'critical';

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface RenewalTerms {
  /** Whether the contract renews automatically when its term ends. */
  autoRenews: boolean;
  /** Length of every renewal term, in months (1..120). Must be a multiple of the payment interval. */
  renewalTermMonths: number;
  /** Price change applied (compounding) at each renewal. -5_000..10_000 bps. */
  renewalAmountChangeBps: Bps;
}

export interface ObligationInput {
  /** Stable id, unique across existing + proposed obligations. */
  id: string;
  label: string;
  counterparty: string;
  /** Amount of ONE payment at base usage. Also the committed floor. Must be >= 1. */
  amountMinor: MinorUnits;
  cadence: Cadence;
  /** First month of the contract term. */
  termStartMonth: MonthLabel;
  /** Initial term length in months (1..120). */
  termMonths: number;
  /** `advance` = pay at the start of each period; `arrears` = in its last month. */
  paymentTiming: PaymentTiming;
  /** If true, the payment scales with the scenario's compute-usage multiplier (never below `amountMinor`). */
  usageSensitive: boolean;
  /** Contractual per-payment ceiling on usage-driven amounts. null/omitted = no cap. */
  periodicCapMinor?: MinorUnits | null;
  /** null/omitted = the contract does not renew. */
  renewal?: RenewalTerms | null;
  /** Notice (months before renewal) required to prevent an auto-renewal. 0..36. */
  terminationNoticeMonths: number;
  /** Optional opaque link back to a FluxContracts record. Never interpreted. */
  externalRef?: string | null;
}

export interface ScenarioAssumptions {
  /** Applied to MRR. -10_000 (-100%) .. 100_000. */
  revenueChangeBps: Bps;
  /** Multiplier on usage-sensitive payments. 10_000 (1.0x) .. 100_000 (10x). */
  usageMultiplierBps: Bps;
  /** If false, auto-renewing contracts lapse at the end of their initial term. */
  renewalsEnabled: boolean;
  /** Months by which delayed customer collections slip. 0..12. */
  customerPaymentDelayMonths: number;
  /** Share of each month's revenue that is delayed. 0..10_000 bps. */
  delayedRevenueShareBps: Bps;
}

export interface TreasuryPolicy {
  /** Cash that must never be touched by "safe to deploy". */
  minimumCashReserveMinor: MinorUnits;
  /** Runway the company wants to keep, in whole months. 0..120. */
  minimumRunwayMonths: number;
  /** A single proposed payment above this share of available cash is flagged. Default 2_500 (25%). */
  largePaymentShareBps?: Bps;
}

export interface PresetParameters {
  /** Default -2_000. Must be in -10_000..0. */
  downsideRevenueBps?: Bps;
  /** Default 2_000. Must be in 0..100_000. */
  upsideRevenueBps?: Bps;
  /** Default 15_000 (1.5x). Must be in 10_000..100_000. */
  highUsageMultiplierBps?: Bps;
  /** Default 2. Must be in 1..12. */
  delayMonths?: number;
}

export interface ExtraScenarioInput {
  id: string;
  label: string;
  description?: string;
  assumptions: ScenarioAssumptions;
}

export interface TwinInput {
  /** Currency or asset code, e.g. "USD", "USDC". 3..10 chars, A-Z0-9. All amounts share it. */
  currency: string;
  /** Digits between the major unit and the minor unit (USD = 2, USDC = 6). Default 2. Display metadata only. */
  minorUnitDecimals?: number;
  /** First simulated month. */
  startMonth: MonthLabel;
  /** Number of months to simulate (1..120). */
  horizonMonths: number;
  cashBalanceMinor: MinorUnits;
  monthlyRecurringRevenueMinor: MinorUnits;
  /** Operating burn that is NOT already modelled as an obligation. Obligations are added on top. */
  existingMonthlyBurnMinor: MinorUnits;
  existingObligations: ObligationInput[];
  proposedObligations: ObligationInput[];
  baseAssumptions: ScenarioAssumptions;
  policy: TreasuryPolicy;
  presetParameters?: PresetParameters;
  extraScenarios?: ExtraScenarioInput[];
}

/* ------------------------------------------------------------------ */
/* Normalised input (defaults applied, fully populated)                */
/* ------------------------------------------------------------------ */

export interface NormalizedRenewal {
  autoRenews: boolean;
  renewalTermMonths: number;
  renewalAmountChangeBps: Bps;
}

export interface NormalizedObligation {
  id: string;
  label: string;
  counterparty: string;
  amountMinor: MinorUnits;
  cadence: Cadence;
  termStartMonth: MonthLabel;
  termMonths: number;
  paymentTiming: PaymentTiming;
  usageSensitive: boolean;
  periodicCapMinor: MinorUnits | null;
  renewal: NormalizedRenewal | null;
  terminationNoticeMonths: number;
  externalRef: string | null;
}

export interface NormalizedPolicy {
  minimumCashReserveMinor: MinorUnits;
  minimumRunwayMonths: number;
  largePaymentShareBps: Bps;
}

export interface NormalizedPresetParameters {
  downsideRevenueBps: Bps;
  upsideRevenueBps: Bps;
  highUsageMultiplierBps: Bps;
  delayMonths: number;
}

export interface NormalizedExtraScenario {
  id: string;
  label: string;
  description: string;
  assumptions: ScenarioAssumptions;
}

export interface NormalizedTwinInput {
  currency: string;
  minorUnitDecimals: number;
  startMonth: MonthLabel;
  horizonMonths: number;
  cashBalanceMinor: MinorUnits;
  monthlyRecurringRevenueMinor: MinorUnits;
  existingMonthlyBurnMinor: MinorUnits;
  existingObligations: NormalizedObligation[];
  proposedObligations: NormalizedObligation[];
  baseAssumptions: ScenarioAssumptions;
  policy: NormalizedPolicy;
  presetParameters: NormalizedPresetParameters;
  extraScenarios: NormalizedExtraScenario[];
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type TwinErrorCode =
  | 'INPUT_NOT_OBJECT'
  | 'MISSING_FIELD'
  | 'UNKNOWN_FIELD'
  | 'WRONG_TYPE'
  | 'NOT_INTEGER'
  | 'OUT_OF_RANGE'
  | 'INVALID_MONTH'
  | 'INVALID_CURRENCY'
  | 'INVALID_ENUM'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'TOO_MANY_OBLIGATIONS'
  | 'TERM_NOT_MULTIPLE_OF_CADENCE'
  | 'RENEWAL_TERM_NOT_MULTIPLE_OF_CADENCE'
  | 'ONE_TIME_CANNOT_RENEW'
  | 'CAP_BELOW_AMOUNT'
  | 'ARITHMETIC_OVERFLOW';

export interface TwinError {
  code: TwinErrorCode;
  /** JSON-path-like location, e.g. "proposedObligations[0].amountMinor". */
  path: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

export type FactUnit =
  | 'minor_units'
  | 'bps'
  | 'months'
  | 'months_x100'
  | 'count'
  | 'month_label'
  | 'text'
  | 'boolean';

export interface FactValue {
  unit: FactUnit;
  value: number | string | boolean | null;
}

export interface PaymentEvent {
  obligationId: string;
  origin: ObligationOrigin;
  month: MonthLabel;
  /** 0-based offset from startMonth. */
  monthOffset: number;
  phase: 'initial_term' | 'renewal';
  /** 0 = initial term, 1 = first renewal, ... */
  renewalCycle: number;
  /** Contract amount for this cycle before usage scaling (includes renewal price changes). */
  baseAmountMinor: MinorUnits;
  /** Amount actually modelled for this scenario. */
  amountMinor: MinorUnits;
  /** True if usage scaling increased the amount above `baseAmountMinor`. */
  usageScaled: boolean;
  /** True if the contractual periodic cap limited the usage-scaled amount. */
  capped: boolean;
}

export interface MonthlyRow {
  monthOffset: number;
  month: MonthLabel;
  openingCashMinor: MinorUnits;
  collectedRevenueMinor: MinorUnits;
  operatingBurnMinor: MinorUnits;
  obligationPaymentsMinor: MinorUnits;
  obligationBreakdown: Array<{ obligationId: string; amountMinor: MinorUnits }>;
  /** collected revenue - operating burn - obligation payments. May be negative. */
  netCashFlowMinor: MinorUnits;
  /** May be negative: the simulation keeps running past zero so deficits are visible. */
  closingCashMinor: MinorUnits;
  /** Revenue booked but not yet collected at month end (delayed-payments scenarios). */
  uncollectedReceivablesMinor: MinorUnits;
}

export type Runway =
  | {
      status: 'depleted';
      /** Runway in hundredths of a month (e.g. 1_250 = 12.50 months). Floor-rounded. */
      monthsX100: number;
      depletionMonth: MonthLabel;
      depletionMonthOffset: number;
    }
  | {
      status: 'funded_through_horizon';
      monthsX100: null;
      /** Cash does not run out in the simulated window; runway is AT LEAST this long. */
      horizonMonths: number;
    };

export interface CommittedItem {
  obligationId: string;
  origin: ObligationOrigin;
  /** Remaining initial-term payments on or after startMonth, at contract base amount. */
  remainingPaymentCount: number;
  totalMinor: MinorUnits;
  withinHorizonMinor: MinorUnits;
  beyondHorizonMinor: MinorUnits;
  lastPaymentMonth: MonthLabel | null;
}

export interface CommittedCapital {
  totalMinor: MinorUnits;
  existingMinor: MinorUnits;
  proposedMinor: MinorUnits;
  withinHorizonMinor: MinorUnits;
  beyondHorizonMinor: MinorUnits;
  items: CommittedItem[];
}

export interface PositionSummary {
  availableCashMinor: MinorUnits;
  contractuallyCommittedCapital: CommittedCapital;
  safeToDeployCapitalMinor: MinorUnits;
  /** Where the safe-to-deploy figure is limited: `monthOffset` null = opening cash itself. */
  safeToDeployBinding: { monthOffset: number | null; month: MonthLabel | null; cashMinor: MinorUnits };
  monthlyNetBurn: {
    /** Average over the horizon. Positive = burning cash. Rounded half away from zero. */
    averageMinor: MinorUnits;
    firstMonthMinor: MinorUnits;
    peakMinor: MinorUnits;
    peakMonth: MonthLabel;
  };
  runway: Runway;
  minimumClosingCash: { minor: MinorUnits; month: MonthLabel };
  endingCashMinor: MinorUnits;
  totals: {
    collectedRevenueMinor: MinorUnits;
    operatingBurnMinor: MinorUnits;
    obligationPaymentsMinor: MinorUnits;
  };
}

export type RiskFlagCode =
  | 'CASH_DEPLETED_WITHIN_HORIZON'
  | 'RUNWAY_BELOW_POLICY_MINIMUM'
  | 'RUNWAY_NOT_VERIFIABLE_WITHIN_HORIZON'
  | 'RESERVE_BREACHED'
  | 'PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL'
  | 'RUNWAY_REDUCED_BY_PROPOSAL'
  | 'LARGE_SINGLE_PAYMENT'
  | 'COMMITMENT_EXTENDS_BEYOND_HORIZON'
  | 'AUTO_RENEWAL_IN_HORIZON'
  | 'RENEWAL_NOTICE_WINDOW_PASSED'
  | 'USAGE_CAP_REACHED'
  | 'NO_PROPOSED_OBLIGATIONS';

export interface RiskFlag {
  code: RiskFlagCode;
  severity: Severity;
  scenarioId: string;
  /** Short deterministic English summary for logs. Downstream NLG should use `facts`. */
  summary: string;
  facts: Record<string, FactValue>;
  relatedObligationIds: string[];
  relatedMonths: MonthLabel[];
}

export interface ResolvedScenario {
  id: string;
  label: string;
  description: string;
  assumptions: ScenarioAssumptions;
}

export interface ScenarioResult {
  scenario: ResolvedScenario;
  /** Existing obligations only. */
  before: PositionSummary;
  /** Existing + proposed obligations. */
  after: PositionSummary;
  deltas: {
    /** after - before, using `monthsX100` or, for funded runways, the horizon as a lower bound. */
    runwayChangeMonthsX100: number;
    /** True when either runway is funded-through-horizon, so the change is a bound, not exact. */
    runwayChangeIsLowerBound: boolean;
    safeToDeployChangeMinor: MinorUnits;
    monthlyNetBurnChangeMinor: MinorUnits;
    endingCashChangeMinor: MinorUnits;
  };
  timeline: { before: MonthlyRow[]; after: MonthlyRow[] };
  /** Every modelled payment (existing + proposed) in the window, chronological. */
  obligationTimeline: PaymentEvent[];
  riskFlags: RiskFlag[];
}

export interface ComparisonRow {
  scenarioId: string;
  label: string;
  runwayBefore: Runway;
  runwayAfter: Runway;
  runwayAfterComparableMonthsX100: number;
  safeToDeployAfterMinor: MinorUnits;
  minimumClosingCashAfterMinor: MinorUnits;
  endingCashAfterMinor: MinorUnits;
  monthlyNetBurnAfterMinor: MinorUnits;
  highestSeverity: Severity | null;
  riskFlagCodes: RiskFlagCode[];
  /** Differences against the `base` scenario (scenario - base). All 0 for base itself. */
  vsBase: {
    runwayAfterComparableMonthsX100: number;
    safeToDeployAfterMinor: MinorUnits;
    minimumClosingCashAfterMinor: MinorUnits;
    endingCashAfterMinor: MinorUnits;
    monthlyNetBurnAfterMinor: MinorUnits;
  };
}

export interface ScenarioComparison {
  rows: ComparisonRow[];
  /** Lowest minimum closing cash after the proposal; ties -> shorter runway -> earlier scenario. */
  worstCaseScenarioId: string;
  /** Highest minimum closing cash after the proposal; same tie-breaks. */
  bestCaseScenarioId: string;
  /** Smallest safe-to-deploy amount across all scenarios (after the proposal). */
  conservativeSafeToDeployMinor: MinorUnits;
}

export type FactMetric =
  | 'available_cash'
  | 'committed_capital'
  | 'safe_to_deploy'
  | 'monthly_net_burn'
  | 'runway'
  | 'minimum_cash'
  | 'scenario_delta'
  | 'risk_flag';

export interface ExplanationFact {
  /** Stable, unique, human-greppable id. */
  factId: string;
  metric: FactMetric;
  /** null = scenario-independent. */
  scenarioId: string | null;
  subject: 'before' | 'after' | 'delta' | 'input';
  /** Key a natural-language module can map to a sentence template. */
  phraseKey: string;
  /** Plain description of the deterministic calculation. */
  formula: string;
  inputs: Record<string, FactValue>;
  result: FactValue;
  /** Optional line-items, e.g. per-obligation contributions to committed capital. */
  components: Array<{ ref: string; value: FactValue }>;
  relatedObligationIds: string[];
  relatedMonths: MonthLabel[];
}

export interface TwinHeadline {
  scenarioId: 'base';
  availableCashMinor: MinorUnits;
  contractuallyCommittedCapitalMinor: MinorUnits;
  safeToDeployCapitalMinor: MinorUnits;
  monthlyNetBurnMinor: MinorUnits;
  runwayBefore: Runway;
  runwayAfter: Runway;
  riskFlags: RiskFlag[];
}

export interface TwinOutput {
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: typeof ENGINE_VERSION;
  currency: string;
  minorUnitDecimals: number;
  startMonth: MonthLabel;
  horizonMonths: number;
  /** The fully-resolved input (defaults applied): the assumptions every number was computed from. */
  assumptionsUsed: NormalizedTwinInput;
  headline: TwinHeadline;
  scenarios: ScenarioResult[];
  comparison: ScenarioComparison;
  explanations: ExplanationFact[];
}

export type TwinResult =
  | { ok: true; output: TwinOutput }
  | { ok: false; errors: TwinError[] };
