import { MAX_MINOR } from './money';
import { cadenceMonths, parseMonth } from './months';
import type {
  Cadence,
  NormalizedExtraScenario,
  NormalizedObligation,
  NormalizedPresetParameters,
  NormalizedRenewal,
  NormalizedTwinInput,
  PaymentTiming,
  ScenarioAssumptions,
  TwinError,
  TwinErrorCode,
} from './types';

export const MAX_HORIZON_MONTHS = 120;
export const MAX_TERM_MONTHS = 120;
export const MAX_OBLIGATIONS_PER_LIST = 500;
export const MAX_EXTRA_SCENARIOS = 20;

export const RESERVED_SCENARIO_IDS: readonly string[] = [
  'base',
  'revenue_down',
  'revenue_up',
  'higher_compute_usage',
  'renewal_off',
  'delayed_customer_payments',
  'combined_downside',
];

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const CURRENCY_RE = /^[A-Z][A-Z0-9]{2,9}$/;
const CADENCES: readonly Cadence[] = ['one_time', 'monthly', 'quarterly', 'semi_annual', 'annual'];
const TIMINGS: readonly PaymentTiming[] = ['advance', 'arrears'];

export type ValidationResult =
  | { ok: true; value: NormalizedTwinInput }
  | { ok: false; errors: TwinError[] };

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Collector {
  readonly errors: TwinError[] = [];
  add(code: TwinErrorCode, path: string, message: string): void {
    this.errors.push({ code, path, message });
  }
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function rejectUnknown(obj: Rec, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      c.add('UNKNOWN_FIELD', join(path, key), `Unknown field "${key}". Check for typos.`);
    }
  }
}

function readInt(
  obj: Rec,
  key: string,
  path: string,
  c: Collector,
  min: number,
  max: number,
  fallback?: number,
): number | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'number') {
    c.add('WRONG_TYPE', p, `"${key}" must be a number (integer).`);
    return undefined;
  }
  if (!Number.isSafeInteger(v)) {
    c.add('NOT_INTEGER', p, `"${key}" must be a safe integer (minor units / basis points / whole months), got ${String(v)}.`);
    return undefined;
  }
  if (v < min || v > max) {
    c.add('OUT_OF_RANGE', p, `"${key}" must be between ${min} and ${max}, got ${v}.`);
    return undefined;
  }
  return v;
}

function readBool(obj: Rec, key: string, path: string, c: Collector): boolean | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'boolean') {
    c.add('WRONG_TYPE', p, `"${key}" must be a boolean.`);
    return undefined;
  }
  return v;
}

function readString(
  obj: Rec,
  key: string,
  path: string,
  c: Collector,
  maxLen: number,
  fallback?: string,
): string | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string') {
    c.add('WRONG_TYPE', p, `"${key}" must be a string.`);
    return undefined;
  }
  if (v.trim() === '' || v.length > maxLen) {
    c.add('OUT_OF_RANGE', p, `"${key}" must be 1..${maxLen} characters and not blank.`);
    return undefined;
  }
  return v;
}

function readMonth(obj: Rec, key: string, path: string, c: Collector): string | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (parseMonth(v) === null) {
    c.add('INVALID_MONTH', p, `"${key}" must be a "YYYY-MM" month between 2000-01 and 2200-12.`);
    return undefined;
  }
  return v as string;
}

function readId(obj: Rec, key: string, path: string, c: Collector): string | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    c.add('INVALID_ID', p, `"${key}" must match ${String(ID_RE)} (letters, digits, _ . : -).`);
    return undefined;
  }
  return v;
}

function readEnum<T extends string>(
  obj: Rec,
  key: string,
  path: string,
  c: Collector,
  allowed: readonly T[],
): T | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    c.add('INVALID_ENUM', p, `"${key}" must be one of: ${allowed.join(', ')}.`);
    return undefined;
  }
  return v as T;
}

function readObject(obj: Rec, key: string, path: string, c: Collector): Rec | undefined {
  const p = join(path, key);
  const v = obj[key];
  if (v === undefined) {
    c.add('MISSING_FIELD', p, `"${key}" is required.`);
    return undefined;
  }
  if (!isRecord(v)) {
    c.add('WRONG_TYPE', p, `"${key}" must be an object.`);
    return undefined;
  }
  return v;
}

/* ------------------------------------------------------------------ */

const ASSUMPTION_KEYS = [
  'revenueChangeBps',
  'usageMultiplierBps',
  'renewalsEnabled',
  'customerPaymentDelayMonths',
  'delayedRevenueShareBps',
] as const;

function parseAssumptions(raw: unknown, path: string, c: Collector): ScenarioAssumptions | undefined {
  if (!isRecord(raw)) {
    c.add(raw === undefined ? 'MISSING_FIELD' : 'WRONG_TYPE', path, 'Scenario assumptions must be an object.');
    return undefined;
  }
  rejectUnknown(raw, ASSUMPTION_KEYS, path, c);
  const revenueChangeBps = readInt(raw, 'revenueChangeBps', path, c, -10_000, 100_000);
  const usageMultiplierBps = readInt(raw, 'usageMultiplierBps', path, c, 10_000, 100_000);
  const renewalsEnabled = readBool(raw, 'renewalsEnabled', path, c);
  const customerPaymentDelayMonths = readInt(raw, 'customerPaymentDelayMonths', path, c, 0, 12);
  const delayedRevenueShareBps = readInt(raw, 'delayedRevenueShareBps', path, c, 0, 10_000);
  if (
    revenueChangeBps === undefined ||
    usageMultiplierBps === undefined ||
    renewalsEnabled === undefined ||
    customerPaymentDelayMonths === undefined ||
    delayedRevenueShareBps === undefined
  ) {
    return undefined;
  }
  return { revenueChangeBps, usageMultiplierBps, renewalsEnabled, customerPaymentDelayMonths, delayedRevenueShareBps };
}

const OBLIGATION_KEYS = [
  'id',
  'label',
  'counterparty',
  'amountMinor',
  'cadence',
  'termStartMonth',
  'termMonths',
  'paymentTiming',
  'usageSensitive',
  'periodicCapMinor',
  'renewal',
  'terminationNoticeMonths',
  'externalRef',
] as const;

const RENEWAL_KEYS = ['autoRenews', 'renewalTermMonths', 'renewalAmountChangeBps'] as const;

function parseObligation(raw: unknown, path: string, c: Collector): NormalizedObligation | undefined {
  if (!isRecord(raw)) {
    c.add('WRONG_TYPE', path, 'Obligation must be an object.');
    return undefined;
  }
  const before = c.errors.length;
  rejectUnknown(raw, OBLIGATION_KEYS, path, c);
  const id = readId(raw, 'id', path, c);
  const label = readString(raw, 'label', path, c, 200);
  const counterparty = readString(raw, 'counterparty', path, c, 200);
  const amountMinor = readInt(raw, 'amountMinor', path, c, 1, MAX_MINOR);
  const cadence = readEnum(raw, 'cadence', path, c, CADENCES);
  const termStartMonth = readMonth(raw, 'termStartMonth', path, c);
  const termMonths = readInt(raw, 'termMonths', path, c, 1, MAX_TERM_MONTHS);
  const paymentTiming = readEnum(raw, 'paymentTiming', path, c, TIMINGS);
  const usageSensitive = readBool(raw, 'usageSensitive', path, c);
  const terminationNoticeMonths = readInt(raw, 'terminationNoticeMonths', path, c, 0, 36);

  let periodicCapMinor: number | null = null;
  if (raw.periodicCapMinor !== undefined && raw.periodicCapMinor !== null) {
    const cap = readInt(raw, 'periodicCapMinor', path, c, 1, MAX_MINOR);
    if (cap !== undefined) {
      periodicCapMinor = cap;
      if (amountMinor !== undefined && cap < amountMinor) {
        c.add('CAP_BELOW_AMOUNT', join(path, 'periodicCapMinor'), 'periodicCapMinor must not be lower than amountMinor (the committed floor).');
      }
    }
  }

  let externalRef: string | null = null;
  if (raw.externalRef !== undefined && raw.externalRef !== null) {
    externalRef = readString(raw, 'externalRef', path, c, 200) ?? null;
  }

  // cadence / term consistency
  if (cadence !== undefined && termMonths !== undefined) {
    const interval = cadenceMonths(cadence, termMonths);
    if (termMonths % interval !== 0) {
      c.add('TERM_NOT_MULTIPLE_OF_CADENCE', join(path, 'termMonths'), `termMonths (${termMonths}) must be a multiple of the ${cadence} interval (${interval}).`);
    }
  }

  let renewal: NormalizedRenewal | null = null;
  if (raw.renewal !== undefined && raw.renewal !== null) {
    const rp = join(path, 'renewal');
    if (!isRecord(raw.renewal)) {
      c.add('WRONG_TYPE', rp, '"renewal" must be an object or null.');
    } else {
      rejectUnknown(raw.renewal, RENEWAL_KEYS, rp, c);
      const autoRenews = readBool(raw.renewal, 'autoRenews', rp, c);
      const renewalTermMonths = readInt(raw.renewal, 'renewalTermMonths', rp, c, 1, MAX_TERM_MONTHS);
      const renewalAmountChangeBps = readInt(raw.renewal, 'renewalAmountChangeBps', rp, c, -5_000, 10_000);
      if (autoRenews !== undefined && renewalTermMonths !== undefined && renewalAmountChangeBps !== undefined) {
        renewal = { autoRenews, renewalTermMonths, renewalAmountChangeBps };
        if (autoRenews && cadence === 'one_time') {
          c.add('ONE_TIME_CANNOT_RENEW', rp, 'A one_time obligation cannot auto-renew. Model a recurring cadence instead.');
        } else if (cadence !== undefined && cadence !== 'one_time') {
          const interval = cadenceMonths(cadence, termMonths ?? 1);
          if (renewalTermMonths % interval !== 0) {
            c.add('RENEWAL_TERM_NOT_MULTIPLE_OF_CADENCE', join(rp, 'renewalTermMonths'), `renewalTermMonths (${renewalTermMonths}) must be a multiple of the ${cadence} interval (${interval}).`);
          }
        }
      }
    }
  }

  if (c.errors.length > before) return undefined;
  if (
    id === undefined || label === undefined || counterparty === undefined || amountMinor === undefined ||
    cadence === undefined || termStartMonth === undefined || termMonths === undefined ||
    paymentTiming === undefined || usageSensitive === undefined || terminationNoticeMonths === undefined
  ) {
    return undefined;
  }
  return {
    id, label, counterparty, amountMinor, cadence, termStartMonth, termMonths, paymentTiming,
    usageSensitive, periodicCapMinor, renewal, terminationNoticeMonths, externalRef,
  };
}

function parseObligationList(
  root: Rec,
  key: 'existingObligations' | 'proposedObligations',
  c: Collector,
): NormalizedObligation[] | undefined {
  const raw = root[key];
  if (raw === undefined) {
    c.add('MISSING_FIELD', key, `"${key}" is required (use an empty array for none).`);
    return undefined;
  }
  if (!Array.isArray(raw)) {
    c.add('WRONG_TYPE', key, `"${key}" must be an array.`);
    return undefined;
  }
  if (raw.length > MAX_OBLIGATIONS_PER_LIST) {
    c.add('TOO_MANY_OBLIGATIONS', key, `"${key}" may hold at most ${MAX_OBLIGATIONS_PER_LIST} obligations.`);
    return undefined;
  }
  const out: NormalizedObligation[] = [];
  let allOk = true;
  raw.forEach((item, i) => {
    const parsed = parseObligation(item, `${key}[${i}]`, c);
    if (parsed === undefined) allOk = false;
    else out.push(parsed);
  });
  return allOk ? out : undefined;
}

const POLICY_KEYS = ['minimumCashReserveMinor', 'minimumRunwayMonths', 'largePaymentShareBps'] as const;
const PRESET_KEYS = ['downsideRevenueBps', 'upsideRevenueBps', 'highUsageMultiplierBps', 'delayMonths'] as const;
const EXTRA_KEYS = ['id', 'label', 'description', 'assumptions'] as const;
const ROOT_KEYS = [
  'currency',
  'minorUnitDecimals',
  'startMonth',
  'horizonMonths',
  'cashBalanceMinor',
  'monthlyRecurringRevenueMinor',
  'existingMonthlyBurnMinor',
  'existingObligations',
  'proposedObligations',
  'baseAssumptions',
  'policy',
  'presetParameters',
  'extraScenarios',
] as const;

/**
 * Validate unknown input and return a fully-populated, normalised copy.
 * Collects ALL problems it can find rather than stopping at the first.
 */
export function validateTwinInput(raw: unknown): ValidationResult {
  const c = new Collector();
  if (!isRecord(raw)) {
    c.add('INPUT_NOT_OBJECT', '', 'Input must be a JSON object.');
    return { ok: false, errors: c.errors };
  }
  rejectUnknown(raw, ROOT_KEYS, '', c);

  // currency
  let currency: string | undefined;
  if (raw.currency === undefined) c.add('MISSING_FIELD', 'currency', '"currency" is required.');
  else if (typeof raw.currency !== 'string' || !CURRENCY_RE.test(raw.currency)) {
    c.add('INVALID_CURRENCY', 'currency', '"currency" must be 3-10 upper-case letters/digits, starting with a letter (e.g. USD, USDC).');
  } else currency = raw.currency;

  const minorUnitDecimals = readInt(raw, 'minorUnitDecimals', '', c, 0, 18, 2);
  const startMonth = readMonth(raw, 'startMonth', '', c);
  const horizonMonths = readInt(raw, 'horizonMonths', '', c, 1, MAX_HORIZON_MONTHS);
  const cashBalanceMinor = readInt(raw, 'cashBalanceMinor', '', c, 0, MAX_MINOR);
  const monthlyRecurringRevenueMinor = readInt(raw, 'monthlyRecurringRevenueMinor', '', c, 0, MAX_MINOR);
  const existingMonthlyBurnMinor = readInt(raw, 'existingMonthlyBurnMinor', '', c, 0, MAX_MINOR);

  const existingObligations = parseObligationList(raw, 'existingObligations', c);
  const proposedObligations = parseObligationList(raw, 'proposedObligations', c);

  // unique ids across both lists
  const seen = new Set<string>();
  for (const [key, list] of [['existingObligations', existingObligations], ['proposedObligations', proposedObligations]] as const) {
    list?.forEach((ob, i) => {
      if (seen.has(ob.id)) c.add('DUPLICATE_ID', `${key}[${i}].id`, `Obligation id "${ob.id}" is used more than once.`);
      seen.add(ob.id);
    });
  }

  const baseAssumptions = parseAssumptions(raw.baseAssumptions, 'baseAssumptions', c);

  // policy
  let policy: NormalizedTwinInput['policy'] | undefined;
  const policyRaw = readObject(raw, 'policy', '', c);
  if (policyRaw) {
    rejectUnknown(policyRaw, POLICY_KEYS, 'policy', c);
    const minimumCashReserveMinor = readInt(policyRaw, 'minimumCashReserveMinor', 'policy', c, 0, MAX_MINOR);
    const minimumRunwayMonths = readInt(policyRaw, 'minimumRunwayMonths', 'policy', c, 0, 120);
    const largePaymentShareBps = readInt(policyRaw, 'largePaymentShareBps', 'policy', c, 0, 10_000, 2_500);
    if (minimumCashReserveMinor !== undefined && minimumRunwayMonths !== undefined && largePaymentShareBps !== undefined) {
      policy = { minimumCashReserveMinor, minimumRunwayMonths, largePaymentShareBps };
    }
  }

  // presets
  let presetParameters: NormalizedPresetParameters | undefined = {
    downsideRevenueBps: -2_000,
    upsideRevenueBps: 2_000,
    highUsageMultiplierBps: 15_000,
    delayMonths: 2,
  };
  if (raw.presetParameters !== undefined) {
    if (!isRecord(raw.presetParameters)) {
      c.add('WRONG_TYPE', 'presetParameters', '"presetParameters" must be an object.');
      presetParameters = undefined;
    } else {
      const pr = raw.presetParameters;
      rejectUnknown(pr, PRESET_KEYS, 'presetParameters', c);
      const d = readInt(pr, 'downsideRevenueBps', 'presetParameters', c, -10_000, 0, -2_000);
      const u = readInt(pr, 'upsideRevenueBps', 'presetParameters', c, 0, 100_000, 2_000);
      const h = readInt(pr, 'highUsageMultiplierBps', 'presetParameters', c, 10_000, 100_000, 15_000);
      const m = readInt(pr, 'delayMonths', 'presetParameters', c, 1, 12, 2);
      presetParameters =
        d !== undefined && u !== undefined && h !== undefined && m !== undefined
          ? { downsideRevenueBps: d, upsideRevenueBps: u, highUsageMultiplierBps: h, delayMonths: m }
          : undefined;
    }
  }

  // extra scenarios
  const extraScenarios: NormalizedExtraScenario[] = [];
  if (raw.extraScenarios !== undefined) {
    if (!Array.isArray(raw.extraScenarios)) {
      c.add('WRONG_TYPE', 'extraScenarios', '"extraScenarios" must be an array.');
    } else if (raw.extraScenarios.length > MAX_EXTRA_SCENARIOS) {
      c.add('OUT_OF_RANGE', 'extraScenarios', `At most ${MAX_EXTRA_SCENARIOS} extra scenarios are allowed.`);
    } else {
      const ids = new Set<string>(RESERVED_SCENARIO_IDS);
      raw.extraScenarios.forEach((item: unknown, i: number) => {
        const p = `extraScenarios[${i}]`;
        if (!isRecord(item)) {
          c.add('WRONG_TYPE', p, 'Extra scenario must be an object.');
          return;
        }
        rejectUnknown(item, EXTRA_KEYS, p, c);
        const id = readId(item, 'id', p, c);
        const label = readString(item, 'label', p, c, 200);
        const description = readString(item, 'description', p, c, 500, '');
        const assumptions = parseAssumptions(item.assumptions, `${p}.assumptions`, c);
        if (id !== undefined) {
          if (ids.has(id)) c.add('DUPLICATE_ID', `${p}.id`, `Scenario id "${id}" is reserved or already used.`);
          ids.add(id);
        }
        if (id !== undefined && label !== undefined && description !== undefined && assumptions !== undefined) {
          extraScenarios.push({ id, label, description, assumptions });
        }
      });
    }
  }

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  if (
    currency === undefined || minorUnitDecimals === undefined || startMonth === undefined ||
    horizonMonths === undefined || cashBalanceMinor === undefined ||
    monthlyRecurringRevenueMinor === undefined || existingMonthlyBurnMinor === undefined ||
    existingObligations === undefined || proposedObligations === undefined ||
    baseAssumptions === undefined || policy === undefined || presetParameters === undefined
  ) {
    // Defensive: every undefined above must already have produced an error.
    return { ok: false, errors: [{ code: 'MISSING_FIELD', path: '', message: 'Input is incomplete.' }] };
  }
  return {
    ok: true,
    value: {
      currency, minorUnitDecimals, startMonth, horizonMonths, cashBalanceMinor,
      monthlyRecurringRevenueMinor, existingMonthlyBurnMinor, existingObligations,
      proposedObligations, baseAssumptions, policy, presetParameters, extraScenarios,
    },
  };
}
