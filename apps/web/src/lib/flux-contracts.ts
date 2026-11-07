export interface EvidenceProposal {
  page: number;
  clause: string;
  excerpt: string;
  confidenceBps: number;
}

export interface ObligationProposal {
  contractTitle: string;
  counterparty: string;
  currency: string;
  totalAmountMinor: string;
  paymentAmountMinor: string;
  intervalDays: number;
  termMonths: number;
  startsAt: string;
  expiresAt: string;
  renewalRequiresApproval: boolean;
  evidence: EvidenceProposal[];
}

export interface ExtractionResult {
  proposal: ObligationProposal;
  mode: "live" | "replay";
  provider: "groq" | "deterministic";
  requiresHumanApproval: true;
  warning?: string;
}

const replayProposal: ObligationProposal = {
  contractTitle: "Axiom Compute Services Agreement",
  counterparty: "Axiom Compute Labs",
  currency: "USD",
  totalAmountMinor: "1200000",
  paymentAmountMinor: "400000",
  intervalDays: 30,
  termMonths: 3,
  startsAt: "2026-12-01",
  expiresAt: "2027-02-28",
  renewalRequiresApproval: true,
  evidence: [
    { page: 1, clause: "Parties", excerpt: "Axiom Compute Labs will provide managed inference capacity.", confidenceBps: 9900 },
    { page: 2, clause: "3.1 Fees", excerpt: "Total fees for the initial term are USD 12,000.", confidenceBps: 9800 },
    { page: 2, clause: "3.2 Schedule", excerpt: "USD 4,000 is payable every thirty days for three months.", confidenceBps: 9700 },
  ],
};

export function deterministicReplay(warning?: string): ExtractionResult {
  return {
    proposal: structuredClone(replayProposal),
    mode: "replay",
    provider: "deterministic",
    requiresHumanApproval: true,
    warning,
  };
}

export function validateProposal(value: unknown): ObligationProposal {
  if (!isRecord(value)) throw new Error("AI response is not an object");

  const evidenceValue = value.evidence;
  if (!Array.isArray(evidenceValue) || evidenceValue.length === 0 || evidenceValue.length > 12) {
    throw new Error("AI response must contain 1-12 evidence citations");
  }

  const proposal: ObligationProposal = {
    contractTitle: text(value.contractTitle, "contractTitle", 160),
    counterparty: text(value.counterparty, "counterparty", 160),
    currency: currency(value.currency),
    totalAmountMinor: minorUnits(value.totalAmountMinor, "totalAmountMinor"),
    paymentAmountMinor: minorUnits(value.paymentAmountMinor, "paymentAmountMinor"),
    intervalDays: integer(value.intervalDays, "intervalDays", 1, 366),
    termMonths: integer(value.termMonths, "termMonths", 1, 120),
    startsAt: isoDate(value.startsAt, "startsAt"),
    expiresAt: isoDate(value.expiresAt, "expiresAt"),
    renewalRequiresApproval: value.renewalRequiresApproval === true,
    evidence: evidenceValue.map((entry, index) => evidence(entry, index)),
  };

  if (new Date(proposal.expiresAt) <= new Date(proposal.startsAt)) {
    throw new Error("expiresAt must be after startsAt");
  }
  return proposal;
}

function evidence(value: unknown, index: number): EvidenceProposal {
  if (!isRecord(value)) throw new Error(`evidence[${index}] is not an object`);
  return {
    page: integer(value.page, `evidence[${index}].page`, 1, 10_000),
    clause: text(value.clause, `evidence[${index}].clause`, 120),
    excerpt: text(value.excerpt, `evidence[${index}].excerpt`, 500),
    confidenceBps: integer(value.confidenceBps, `evidence[${index}].confidenceBps`, 0, 10_000),
  };
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function currency(value: unknown): string {
  const result = text(value, "currency", 8).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2,7}$/.test(result)) throw new Error("currency is invalid");
  return result;
}

function minorUnits(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,20})$/.test(value)) {
    throw new Error(`${name} must be a non-negative decimal minor-unit string`);
  }
  return value;
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function isoDate(value: unknown, name: string): string {
  const result = text(value, name, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
