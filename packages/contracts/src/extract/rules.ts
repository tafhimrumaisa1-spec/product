import { addMonthsIso, compareIso, parseAmountToMinor } from '../money.js';
import { sha256Hex } from '../canonical.js';
import {
  ok,
  type ContractDocument,
  type ContractExtractor,
  type ExtractionProposal,
  type ExtractorInfo,
  type Installment,
  type ProposedObligation,
  type SourceSpan,
  type Result,
} from '../types.js';

/**
 * Deterministic baseline extractor for the synthetic golden-demo contract format.
 * It is NOT a general contract parser; it exists so the demo and tests run offline
 * and so AI output can be compared against a known-good reference.
 */

const AMT = '([\\d,]+(?:\\.\\d{1,2})?)';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

interface Hit {
  readonly m: RegExpExecArray;
  readonly span: SourceSpan;
}

function find(text: string, re: RegExp): Hit | null {
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index;
  const end = start + m[0].length;
  return { m, span: { start, end, quote: text.slice(start, end) } };
}

export const RULES_EXTRACTOR_INFO: ExtractorInfo = {
  name: 'fluxcontracts-rules-baseline',
  version: '1.0.0',
  kind: 'rules',
};

export function extractWithRules(doc: ContractDocument): ExtractionProposal {
  const t = doc.text;
  const out: ProposedObligation[] = [];
  const CONF = 0.95;

  const parties = find(t, /between\s+(.+?)\s+\("Vendor"\)\s+and\s+(.+?)\s+\("Customer"\)/s);
  if (parties) {
    out.push({
      terms: { kind: 'PARTIES', vendor: (parties.m[1] as string).trim(), customer: (parties.m[2] as string).trim() },
      evidence: [parties.span],
      confidence: CONF,
    });
  }

  const total = find(t, new RegExp(`a total of ([A-Z]{3}) ${AMT}`));
  if (total) {
    const minor = parseAmountToMinor(total.m[2] as string);
    if (minor !== null) {
      out.push({
        terms: { kind: 'TOTAL_VALUE', total: { amountMinor: minor, currency: total.m[1] as string } },
        evidence: [total.span],
        confidence: CONF,
      });
    }
  }

  const cap = find(t, new RegExp(`in any calendar (month|quarter) shall not exceed ([A-Z]{3}) ${AMT}`));
  if (cap) {
    const minor = parseAmountToMinor(cap.m[3] as string);
    if (minor !== null) {
      out.push({
        terms: {
          kind: 'PERIODIC_CAP',
          cap: { amountMinor: minor, currency: cap.m[2] as string },
          period: cap.m[1] === 'quarter' ? 'QUARTER' : 'MONTH',
        },
        evidence: [cap.span],
        confidence: CONF,
      });
    }
  }

  const term = find(t, new RegExp(`begins on ${DATE} and ends on ${DATE} \\((\\d+) months?\\)`));
  if (term) {
    out.push({
      terms: {
        kind: 'TERM',
        startDate: term.m[1] as string,
        endDate: term.m[2] as string,
        durationMonths: Number(term.m[3]),
      },
      evidence: [term.span],
      confidence: CONF,
    });
  }

  const sched = find(
    t,
    new RegExp(`(\\w+) installments of ([A-Z]{3}) ${AMT}, due on the first day of each month from ${DATE} through ${DATE}`),
  );
  if (sched) {
    const minor = parseAmountToMinor(sched.m[3] as string);
    const first = sched.m[4] as string;
    const last = sched.m[5] as string;
    if (minor !== null) {
      const installments: Installment[] = [];
      for (let i = 0; i < 240; i += 1) {
        const d = addMonthsIso(first, i);
        if (d === null || compareIso(d, last) > 0) break;
        installments.push({ dueDate: d, amount: { amountMinor: minor, currency: sched.m[2] as string } });
      }
      const word = (sched.m[1] as string).toLowerCase();
      const stated = COUNT_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : null);
      out.push({
        terms: { kind: 'PAYMENT_SCHEDULE', installments },
        evidence: [sched.span],
        // Lower confidence when the stated count disagrees with the generated dates.
        confidence: stated === installments.length ? CONF : 0.5,
      });
    }
  }

  const renew = find(
    t,
    /renews automatically for successive (\d+)-month terms unless either party gives (\d+) days' written notice of non-renewal/,
  );
  if (renew) {
    out.push({
      terms: {
        kind: 'RENEWAL',
        autoRenew: true,
        renewalTermMonths: Number(renew.m[1]),
        nonRenewalNoticeDays: Number(renew.m[2]),
      },
      evidence: [renew.span],
      confidence: CONF,
    });
  } else {
    const noRenew = find(t, /shall not renew automatically/);
    if (noRenew) {
      out.push({
        terms: { kind: 'RENEWAL', autoRenew: false, renewalTermMonths: null, nonRenewalNoticeDays: null },
        evidence: [noRenew.span],
        confidence: CONF,
      });
    }
  }

  const termn = find(t, /may terminate for convenience with (\d+) days' written notice/);
  if (termn) {
    out.push({
      terms: { kind: 'TERMINATION', forConvenience: true, noticeDays: Number(termn.m[1]) },
      evidence: [termn.span],
      confidence: CONF,
    });
  }

  return {
    contractId: doc.contractId,
    documentSha256: sha256Hex(doc.text),
    extractor: RULES_EXTRACTOR_INFO,
    obligations: out,
  };
}

export class RulesExtractor implements ContractExtractor {
  readonly info = RULES_EXTRACTOR_INFO;
  async extract(doc: ContractDocument): Promise<Result<ExtractionProposal>> {
    return ok(extractWithRules(doc));
  }
}
