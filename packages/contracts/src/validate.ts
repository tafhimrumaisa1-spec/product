import {
  compareIso,
  parseIsoDate,
  wholeMonthsInclusive,
} from './money.js';
import {
  err,
  ok,
  type CapPeriod,
  type Installment,
  type Issue,
  type Money,
  type Obligation,
  type ObligationTerms,
  type Result,
  type SourceSpan,
} from './types.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

// ------------------------------------------------------------ structural parse
// Used for untrusted input (AI output, UI edits). Returns a fresh, typed copy.

function parseMoney(v: unknown, path: string, errors: string[]): Money | null {
  if (!isRec(v) || typeof v['amountMinor'] !== 'number' || typeof v['currency'] !== 'string') {
    errors.push(`${path}: expected {amountMinor:number,currency:string}`);
    return null;
  }
  return { amountMinor: v['amountMinor'], currency: v['currency'] };
}

const str = (r: Rec, k: string, errors: string[]): string => {
  const v = r[k];
  if (typeof v !== 'string') {
    errors.push(`${k}: expected string`);
    return '';
  }
  return v;
};
const nullableNum = (r: Rec, k: string, errors: string[]): number | null => {
  const v = r[k];
  if (v === null) return null;
  if (typeof v !== 'number') {
    errors.push(`${k}: expected number or null`);
    return null;
  }
  return v;
};

export function parseTerms(input: unknown): Result<ObligationTerms> {
  const errors: string[] = [];
  if (!isRec(input) || typeof input['kind'] !== 'string') {
    return err('INVALID_INPUT', 'terms must be an object with a string "kind"');
  }
  let terms: ObligationTerms | null = null;
  switch (input['kind']) {
    case 'PARTIES':
      terms = { kind: 'PARTIES', vendor: str(input, 'vendor', errors), customer: str(input, 'customer', errors) };
      break;
    case 'TOTAL_VALUE': {
      const total = parseMoney(input['total'], 'total', errors);
      if (total) terms = { kind: 'TOTAL_VALUE', total };
      break;
    }
    case 'PERIODIC_CAP': {
      const cap = parseMoney(input['cap'], 'cap', errors);
      const period = input['period'];
      if (period !== 'MONTH' && period !== 'QUARTER') errors.push('period: expected MONTH or QUARTER');
      if (cap && (period === 'MONTH' || period === 'QUARTER')) {
        terms = { kind: 'PERIODIC_CAP', cap, period: period as CapPeriod };
      }
      break;
    }
    case 'PAYMENT_SCHEDULE': {
      const raw = input['installments'];
      if (!Array.isArray(raw)) {
        errors.push('installments: expected array');
        break;
      }
      const installments: Installment[] = [];
      raw.forEach((it: unknown, i) => {
        if (!isRec(it) || typeof it['dueDate'] !== 'string') {
          errors.push(`installments[${i}]: expected {dueDate,amount}`);
          return;
        }
        const amount = parseMoney(it['amount'], `installments[${i}].amount`, errors);
        if (amount) installments.push({ dueDate: it['dueDate'], amount });
      });
      if (installments.length === raw.length) terms = { kind: 'PAYMENT_SCHEDULE', installments };
      break;
    }
    case 'TERM':
      terms = {
        kind: 'TERM',
        startDate: str(input, 'startDate', errors),
        endDate: str(input, 'endDate', errors),
        durationMonths: typeof input['durationMonths'] === 'number' ? input['durationMonths'] : NaN,
      };
      if (typeof input['durationMonths'] !== 'number') errors.push('durationMonths: expected number');
      break;
    case 'RENEWAL':
      if (typeof input['autoRenew'] !== 'boolean') errors.push('autoRenew: expected boolean');
      terms = {
        kind: 'RENEWAL',
        autoRenew: input['autoRenew'] === true,
        renewalTermMonths: nullableNum(input, 'renewalTermMonths', errors),
        nonRenewalNoticeDays: nullableNum(input, 'nonRenewalNoticeDays', errors),
      };
      break;
    case 'TERMINATION':
      if (typeof input['forConvenience'] !== 'boolean') errors.push('forConvenience: expected boolean');
      terms = {
        kind: 'TERMINATION',
        forConvenience: input['forConvenience'] === true,
        noticeDays: nullableNum(input, 'noticeDays', errors),
      };
      break;
    default:
      return err('INVALID_INPUT', `unknown obligation kind "${String(input['kind'])}"`);
  }
  if (errors.length > 0 || terms === null) {
    return err('INVALID_INPUT', `invalid ${String(input['kind'])} terms`, errors);
  }
  return ok(terms);
}

export function parseSpans(input: unknown): Result<readonly SourceSpan[]> {
  if (!Array.isArray(input)) return err('INVALID_INPUT', 'evidence must be an array');
  const out: SourceSpan[] = [];
  for (const [i, s] of input.entries()) {
    if (!isRec(s) || !Number.isInteger(s['start']) || !Number.isInteger(s['end']) || typeof s['quote'] !== 'string') {
      return err('INVALID_INPUT', `evidence[${i}]: expected {start:int,end:int,quote:string}`);
    }
    out.push({ start: s['start'] as number, end: s['end'] as number, quote: s['quote'] });
  }
  return ok(out);
}

// -------------------------------------------------------------- semantic checks

const posInt = (n: number | null): boolean => n !== null && Number.isInteger(n) && n > 0;
const goodMoney = (m: Money): boolean =>
  Number.isSafeInteger(m.amountMinor) && m.amountMinor > 0 && /^[A-Z]{3,5}$/.test(m.currency);

/** Field-level checks for a single obligation's terms. */
export function validateTerms(id: string, t: ObligationTerms): Issue[] {
  const issues: Issue[] = [];
  const bad = (code: string, message: string): void => {
    issues.push({ severity: 'error', code, message, obligationIds: [id] });
  };
  switch (t.kind) {
    case 'PARTIES':
      if (t.vendor.trim() === '') bad('FIELD_INVALID', 'vendor name is empty');
      if (t.customer.trim() === '') bad('FIELD_INVALID', 'customer name is empty');
      break;
    case 'TOTAL_VALUE':
      if (!goodMoney(t.total)) bad('FIELD_INVALID', 'total must be a positive integer amount with a currency code');
      break;
    case 'PERIODIC_CAP':
      if (!goodMoney(t.cap)) bad('FIELD_INVALID', 'cap must be a positive integer amount with a currency code');
      break;
    case 'PAYMENT_SCHEDULE':
      if (t.installments.length === 0) bad('FIELD_INVALID', 'payment schedule has no installments');
      for (const [i, it] of t.installments.entries()) {
        if (parseIsoDate(it.dueDate) === null) bad('FIELD_INVALID', `installment ${i + 1}: invalid date "${it.dueDate}"`);
        if (!goodMoney(it.amount)) bad('FIELD_INVALID', `installment ${i + 1}: invalid amount`);
      }
      break;
    case 'TERM': {
      const okStart = parseIsoDate(t.startDate) !== null;
      const okEnd = parseIsoDate(t.endDate) !== null;
      if (!okStart) bad('FIELD_INVALID', `invalid start date "${t.startDate}"`);
      if (!okEnd) bad('FIELD_INVALID', `invalid end date "${t.endDate}"`);
      if (!posInt(t.durationMonths)) bad('FIELD_INVALID', 'durationMonths must be a positive integer');
      if (okStart && okEnd) {
        if (compareIso(t.startDate, t.endDate) >= 0) bad('FIELD_INVALID', 'end date must be after start date');
        else if (wholeMonthsInclusive(t.startDate, t.endDate) !== t.durationMonths) {
          bad('TERM_DURATION_MISMATCH', 'stated duration does not match the start and end dates');
        }
      }
      break;
    }
    case 'RENEWAL':
      if (t.autoRenew && !posInt(t.renewalTermMonths)) bad('FIELD_INVALID', 'auto-renewal requires a positive renewal term');
      if (t.renewalTermMonths !== null && !posInt(t.renewalTermMonths)) bad('FIELD_INVALID', 'renewal term must be a positive integer');
      if (t.nonRenewalNoticeDays !== null && !posInt(t.nonRenewalNoticeDays)) bad('FIELD_INVALID', 'non-renewal notice must be a positive integer');
      break;
    case 'TERMINATION':
      if (t.forConvenience && !posInt(t.noticeDays)) bad('FIELD_INVALID', 'termination for convenience requires a positive notice period');
      if (t.noticeDays !== null && !posInt(t.noticeDays)) bad('FIELD_INVALID', 'notice days must be a positive integer');
      break;
  }
  return issues;
}

/** Every evidence span must exist in the document and quote it verbatim. */
export function validateEvidence(o: Pick<Obligation, 'id' | 'evidence'>, text: string): Issue[] {
  const issues: Issue[] = [];
  if (o.evidence.length === 0) {
    issues.push({ severity: 'error', code: 'EVIDENCE_MISSING', message: 'no supporting contract excerpt', obligationIds: [o.id] });
  }
  for (const [i, s] of o.evidence.entries()) {
    if (s.start < 0 || s.end > text.length || s.start >= s.end) {
      issues.push({ severity: 'error', code: 'EVIDENCE_OUT_OF_RANGE', message: `evidence ${i + 1} is outside the document`, obligationIds: [o.id] });
    } else if (text.slice(s.start, s.end) !== s.quote) {
      issues.push({ severity: 'error', code: 'EVIDENCE_MISMATCH', message: `evidence ${i + 1} does not match the document text`, obligationIds: [o.id] });
    }
  }
  return issues;
}

const periodKey = (date: string, period: CapPeriod): string => {
  const p = parseIsoDate(date);
  if (!p) return 'invalid';
  return period === 'MONTH' ? date.slice(0, 7) : `${p.y}-Q${Math.ceil(p.m / 3)}`;
};

/** Cross-obligation consistency. Rejected obligations are ignored. */
export function crossChecks(all: readonly Obligation[]): Issue[] {
  const live = all.filter((o) => o.status !== 'REJECTED');
  const issues: Issue[] = [];

  const byKind = new Map<string, Obligation[]>();
  for (const o of live) byKind.set(o.kind, [...(byKind.get(o.kind) ?? []), o]);
  for (const [kind, list] of byKind) {
    if (list.length > 1) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_KIND',
        message: `more than one ${kind} obligation; reject or edit until one remains`,
        obligationIds: list.map((o) => o.id),
      });
    }
  }

  const only = <K extends ObligationTerms['kind']>(k: K) => {
    const l = byKind.get(k);
    if (!l || l.length !== 1) return null;
    const o = l[0] as Obligation;
    return { o, t: o.terms as Extract<ObligationTerms, { kind: K }> };
  };
  const total = only('TOTAL_VALUE');
  const cap = only('PERIODIC_CAP');
  const sched = only('PAYMENT_SCHEDULE');
  const term = only('TERM');

  if (sched) {
    const sum = sched.t.installments.reduce((a, i) => a + i.amount.amountMinor, 0);
    const currencies = new Set(sched.t.installments.map((i) => i.amount.currency));
    if (currencies.size > 1) {
      issues.push({ severity: 'error', code: 'CURRENCY_MISMATCH', message: 'installments use more than one currency', obligationIds: [sched.o.id] });
    }
    if (total) {
      if (currencies.size === 1 && !currencies.has(total.t.total.currency)) {
        issues.push({ severity: 'error', code: 'CURRENCY_MISMATCH', message: 'schedule currency differs from total value currency', obligationIds: [sched.o.id, total.o.id] });
      } else if (sum !== total.t.total.amountMinor) {
        issues.push({ severity: 'error', code: 'SCHEDULE_TOTAL_MISMATCH', message: `installments sum to ${sum} minor units but total value is ${total.t.total.amountMinor}`, obligationIds: [sched.o.id, total.o.id] });
      }
    }
    if (cap) {
      if (currencies.size === 1 && !currencies.has(cap.t.cap.currency)) {
        issues.push({ severity: 'error', code: 'CURRENCY_MISMATCH', message: 'schedule currency differs from cap currency', obligationIds: [sched.o.id, cap.o.id] });
      } else {
        const buckets = new Map<string, number>();
        for (const i of sched.t.installments) {
          const k = periodKey(i.dueDate, cap.t.period);
          buckets.set(k, (buckets.get(k) ?? 0) + i.amount.amountMinor);
        }
        for (const [k, v] of buckets) {
          if (v > cap.t.cap.amountMinor) {
            issues.push({ severity: 'error', code: 'CAP_EXCEEDED', message: `scheduled payments in ${k} (${v}) exceed the periodic cap (${cap.t.cap.amountMinor})`, obligationIds: [sched.o.id, cap.o.id] });
          }
        }
      }
    }
    if (term && parseIsoDate(term.t.startDate) && parseIsoDate(term.t.endDate)) {
      for (const [i, it] of sched.t.installments.entries()) {
        if (compareIso(it.dueDate, term.t.startDate) < 0 || compareIso(it.dueDate, term.t.endDate) > 0) {
          issues.push({ severity: 'error', code: 'INSTALLMENT_OUTSIDE_TERM', message: `installment ${i + 1} (${it.dueDate}) falls outside the contract term`, obligationIds: [sched.o.id, term.o.id] });
        }
      }
    }
  }

  return issues;
}

/** All issues for a set of obligations against the document text. */
export function computeIssues(obligations: readonly Obligation[], text: string): Issue[] {
  const issues: Issue[] = [];
  for (const o of obligations) {
    if (o.status === 'REJECTED') continue;
    issues.push(...validateTerms(o.id, o.terms), ...validateEvidence(o, text));
    if (o.confidence < 0.8) {
      issues.push({ severity: 'warning', code: 'LOW_CONFIDENCE', message: `extractor confidence ${o.confidence.toFixed(2)} is below 0.80`, obligationIds: [o.id] });
    }
  }
  issues.push(...crossChecks(obligations));
  return issues;
}
