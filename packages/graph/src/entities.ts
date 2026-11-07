import { z } from "zod";
import { ActorSchema } from "./actor";
import { POLICY_OUTCOMES } from "./policy";
import { IdSchemas } from "./ids";
import {
  addIssue, addMonths, Currency, HashCommitment, IsoDate, IsoTimestamp, MoneySchema, SignedMoneySchema,
  Slug, SolanaAddress, SolanaSignature, SpendPeriod, text, YearMonth,
} from "./primitives";
import {
  CONTRACT_STATUSES, MANDATE_STATUSES, OBLIGATION_STATUSES, SETTLEMENT_STATUSES, SPEND_INTENT_STATUSES,
} from "./statuses";

/* ----------------------------------------------------------------------------------------------
 * Conventions
 *  - Every object is .strict(): unknown keys are rejected (no smuggled secrets or shadow fields).
 *  - "Mutable" entities carry revision / createdAt / updatedAt. Only state-machine helpers bump them.
 *  - Append-only entities (PolicyDecision, LedgerEntry, AuditEvent, EvidenceCitation, Forecast) have none.
 *  - Money is integer minor units as strings. No floats on any financial path.
 *  - Contract text never appears here except EvidenceCitation.excerpt, which is PRIVATE (never in events/on-chain).
 * -------------------------------------------------------------------------------------------- */

const mutable = {
  revision: z.number().int().min(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
};
const orderedTimes = (v: { createdAt: string; updatedAt: string }, ctx: z.RefinementCtx): void => {
  if (v.updatedAt < v.createdAt) addIssue(ctx, ["updatedAt"], "updatedAt must not precede createdAt");
};

/* ------------------------------------------------------------------ Tenancy & principals */

export const OrganizationSchema = z.object({
  id: IdSchemas.organization,
  name: text(120),
  /** Product constraint for this build: synthetic data only. Widening this literal is a deliberate roadmap decision. */
  environment: z.literal("synthetic"),
  createdAt: IsoTimestamp,
}).strict();
export type Organization = z.infer<typeof OrganizationSchema>;

export const CompanySchema = z.object({
  id: IdSchemas.company,
  organizationId: IdSchemas.organization,
  legalName: text(160),
  baseCurrency: Currency,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  createdAt: IsoTimestamp,
}).strict();
export type Company = z.infer<typeof CompanySchema>;

export const USER_ROLES = ["owner", "finance_approver", "legal_reviewer", "auditor", "viewer"] as const;
export const HumanUserSchema = z.object({
  id: IdSchemas.user,
  organizationId: IdSchemas.organization,
  displayName: text(120),
  email: z.string().email().max(254),
  roles: z.array(z.enum(USER_ROLES)).min(1).max(USER_ROLES.length),
  status: z.enum(["active", "disabled"]),
  createdAt: IsoTimestamp,
}).strict();
export type HumanUser = z.infer<typeof HumanUserSchema>;

export const AgentSchema = z.object({
  id: IdSchemas.agent,
  companyId: IdSchemas.company,
  name: text(120),
  ownerUserId: IdSchemas.user,
  /** Public address of the agent's own wallet. Public keys only. */
  walletAddress: SolanaAddress.nullable(),
  /** Security invariant, encoded in the type: agents never hold treasury signing keys. */
  holdsTreasuryKey: z.literal(false),
  status: z.enum(["active", "suspended", "retired"]),
  ...mutable,
}).strict().superRefine(orderedTimes);
export type Agent = z.infer<typeof AgentSchema>;

export const CounterpartySchema = z.object({
  id: IdSchemas.counterparty,
  companyId: IdSchemas.company,
  legalName: text(160),
  kind: z.enum(["vendor", "customer"]),
  payoutAddress: SolanaAddress.nullable(),
  verification: z.enum(["unverified", "verified"]),
  createdAt: IsoTimestamp,
}).strict();
export type Counterparty = z.infer<typeof CounterpartySchema>;

/* ------------------------------------------------------------------ Contracts */

export const ModelRefSchema = z.object({
  provider: text(40),
  model: text(80),
  promptVersion: text(40),
}).strict();
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ContractSchema = z.object({
  id: IdSchemas.contract,
  companyId: IdSchemas.company,
  counterpartyId: IdSchemas.counterparty,
  title: text(200),
  status: z.enum(CONTRACT_STATUSES),
  currentVersionId: IdSchemas.contractVersion,
  ...mutable,
}).strict().superRefine(orderedTimes);
export type Contract = z.infer<typeof ContractSchema>;

export const ExtractedTermsSchema = z.object({
  vendorName: text(160),
  totalContractValue: MoneySchema,
  startDate: IsoDate,
  endDate: IsoDate,
  durationMonths: z.number().int().min(1).max(120),
  periodicCap: z.object({ amount: MoneySchema, period: SpendPeriod }).strict().nullable(),
  paymentSchedule: z.array(z.object({ dueDate: IsoDate, amount: MoneySchema, description: text(200) }).strict()).min(1).max(120),
  renewal: z.object({
    autoRenew: z.boolean(),
    noticeDays: z.number().int().min(0).max(365),
    renewalTermMonths: z.number().int().min(1).max(120).nullable(),
  }).strict(),
  termination: z.object({
    noticeDays: z.number().int().min(0).max(365),
    forCauseAllowed: z.boolean(),
    earlyTerminationFee: MoneySchema.nullable(),
  }).strict(),
}).strict().superRefine((t, ctx) => {
  if (t.endDate <= t.startDate) addIssue(ctx, ["endDate"], "endDate must be after startDate");
  if (t.renewal.autoRenew && t.renewal.renewalTermMonths === null) addIssue(ctx, ["renewal", "renewalTermMonths"], "autoRenew requires renewalTermMonths");
});
export type ExtractedTerms = z.infer<typeof ExtractedTermsSchema>;

const extractionBase = { model: ModelRefSchema.nullable() };
export const ExtractionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), ...extractionBase, terms: z.null(), termsCommitment: z.null(), extractedAt: z.null(), failureReason: z.null() }).strict(),
  z.object({ status: z.literal("succeeded"), model: ModelRefSchema, terms: ExtractedTermsSchema, termsCommitment: HashCommitment, extractedAt: IsoTimestamp, failureReason: z.null() }).strict(),
  z.object({ status: z.literal("failed"), ...extractionBase, terms: z.null(), termsCommitment: z.null(), extractedAt: z.null(), failureReason: text(300) }).strict(),
]);
export type ExtractionState = z.infer<typeof ExtractionStateSchema>;

export const ContractVersionSchema = z.object({
  id: IdSchemas.contractVersion,
  contractId: IdSchemas.contract,
  companyId: IdSchemas.company,
  versionNumber: z.number().int().min(1),
  /** Salted commitment to the document bytes. The document itself stays in private storage. */
  documentCommitment: HashCommitment,
  /** Opaque pointer into the company's private vault. Never resolvable from the graph or on-chain. */
  documentRef: z.string().regex(/^vault:\/\/[a-z0-9][a-z0-9\-_\/.]{2,200}$/),
  mediaType: z.enum(["application/pdf", "text/plain"]),
  uploadedBy: IdSchemas.user,
  uploadedAt: IsoTimestamp,
  extraction: ExtractionStateSchema,
}).strict();
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

export const EvidenceCitationSchema = z.object({
  id: IdSchemas.citation,
  companyId: IdSchemas.company,
  contractVersionId: IdSchemas.contractVersion,
  /** Which extracted term this supports, e.g. "periodicCap.amount" or "paymentSchedule[0]". */
  termPath: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.\[\]]{0,80}$/),
  pageNumber: z.number().int().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  /** PRIVATE: verbatim contract text. Must never be placed in a domain event, audit event or on-chain. */
  excerpt: text(600),
  excerptCommitment: HashCommitment,
  confidence: z.number().min(0).max(1),
  extractedBy: ModelRefSchema,
  createdAt: IsoTimestamp,
}).strict().superRefine((c, ctx) => {
  if (c.endOffset <= c.startOffset) addIssue(ctx, ["endOffset"], "endOffset must be greater than startOffset");
});
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;

export const OBLIGATION_KINDS = ["payment", "periodic_cap", "renewal_notice", "termination_notice"] as const;
export const ReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  /** Always a HumanUser. The type makes it impossible to record an AI or agent as the reviewer. */
  byUserId: IdSchemas.user,
  at: IsoTimestamp,
  note: text(300).nullable(),
}).strict();

export const ObligationSchema = z.object({
  id: IdSchemas.obligation,
  companyId: IdSchemas.company,
  contractId: IdSchemas.contract,
  contractVersionId: IdSchemas.contractVersion,
  counterpartyId: IdSchemas.counterparty,
  kind: z.enum(OBLIGATION_KINDS),
  description: text(300),
  /** Material obligations must be human-approved before the contract can activate. */
  material: z.boolean(),
  amount: MoneySchema.nullable(),
  period: SpendPeriod.nullable(),
  dueDate: IsoDate.nullable(),
  noticeDays: z.number().int().min(0).max(365).nullable(),
  citationIds: z.array(IdSchemas.citation).min(1),
  source: z.enum(["ai_extracted", "human_entered"]),
  status: z.enum(OBLIGATION_STATUSES),
  review: ReviewSchema.nullable(),
  ...mutable,
}).strict().superRefine((o, ctx) => {
  orderedTimes(o, ctx);
  if ((o.kind === "payment" || o.kind === "periodic_cap") && o.amount === null) addIssue(ctx, ["amount"], `${o.kind} obligations require an amount`);
  if (o.kind === "periodic_cap" && o.period === null) addIssue(ctx, ["period"], "periodic_cap obligations require a period");
  if ((o.kind === "renewal_notice" || o.kind === "termination_notice") && o.noticeDays === null) addIssue(ctx, ["noticeDays"], `${o.kind} obligations require noticeDays`);
  if (o.status === "proposed") {
    if (o.review !== null) addIssue(ctx, ["review"], "a proposed obligation has no review yet");
  } else if (o.status === "rejected") {
    if (o.review?.decision !== "rejected") addIssue(ctx, ["review"], "a rejected obligation requires a rejecting human review");
  } else if (o.review?.decision !== "approved") {
    addIssue(ctx, ["review"], `status ${o.status} requires a prior human approval`);
  }
});
export type Obligation = z.infer<typeof ObligationSchema>;

/* ------------------------------------------------------------------ Authority */

export const BudgetSchema = z.object({
  id: IdSchemas.budget,
  companyId: IdSchemas.company,
  name: text(120),
  scope: z.enum(["company", "contract", "agent"]),
  contractId: IdSchemas.contract.nullable(),
  agentId: IdSchemas.agent.nullable(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  limit: MoneySchema,
  status: z.enum(["active", "closed"]),
  createdBy: IdSchemas.user,
  ...mutable,
}).strict().superRefine((b, ctx) => {
  orderedTimes(b, ctx);
  if (b.periodEnd < b.periodStart) addIssue(ctx, ["periodEnd"], "periodEnd must not precede periodStart");
  if (b.scope === "contract" && b.contractId === null) addIssue(ctx, ["contractId"], "contract-scoped budget requires contractId");
  if (b.scope === "agent" && b.agentId === null) addIssue(ctx, ["agentId"], "agent-scoped budget requires agentId");
});
export type Budget = z.infer<typeof BudgetSchema>;

export const MandateRegistrySchema = z.object({
  network: z.literal("solana-devnet"),
  authorityAccount: SolanaAddress,
  /** Commitment to the on-chain authority state (never the contract text). */
  authorityStateCommitment: HashCommitment,
  registrationSignature: SolanaSignature,
  registeredAt: IsoTimestamp,
}).strict();
export type MandateRegistry = z.infer<typeof MandateRegistrySchema>;

export const MandateSchema = z.object({
  id: IdSchemas.mandate,
  companyId: IdSchemas.company,
  contractId: IdSchemas.contract,
  obligationIds: z.array(IdSchemas.obligation).min(1),
  counterpartyId: IdSchemas.counterparty,
  /** The single agent this mandate lets spend. */
  delegateAgentId: IdSchemas.agent,
  budgetId: IdSchemas.budget,
  limits: z.object({
    perTransaction: MoneySchema,
    perPeriod: z.object({ amount: MoneySchema, period: SpendPeriod }).strict(),
    total: MoneySchema,
  }).strict(),
  /** Spends above this amount escalate to a human even if within limits. Null = no escalation threshold. */
  requireHumanApprovalAbove: MoneySchema.nullable(),
  validFrom: IsoTimestamp,
  validUntil: IsoTimestamp,
  /** Salted commitment to the canonical limits; what the on-chain registry stores. */
  termsCommitment: HashCommitment,
  proposedBy: ActorSchema,
  /** Human approvals only (UserId). AI cannot appear here. */
  approvals: z.array(z.object({ userId: IdSchemas.user, at: IsoTimestamp }).strict()),
  registry: MandateRegistrySchema.nullable(),
  status: z.enum(MANDATE_STATUSES),
  ...mutable,
}).strict().superRefine((m, ctx) => {
  orderedTimes(m, ctx);
  if (m.validUntil <= m.validFrom) addIssue(ctx, ["validUntil"], "validUntil must be after validFrom");
  const c = m.limits.total.currency;
  const sameCcy = [m.limits.perTransaction.currency, m.limits.perPeriod.amount.currency, m.requireHumanApprovalAbove?.currency ?? c];
  if (sameCcy.some((x) => x !== c)) addIssue(ctx, ["limits"], "all mandate amounts must share one currency");
  else {
    if (BigInt(m.limits.perTransaction.amountMinor) > BigInt(m.limits.total.amountMinor)) addIssue(ctx, ["limits", "perTransaction"], "perTransaction must not exceed total");
    if (BigInt(m.limits.perTransaction.amountMinor) > BigInt(m.limits.perPeriod.amount.amountMinor)) addIssue(ctx, ["limits", "perTransaction"], "perTransaction must not exceed perPeriod");
  }
  const needsApproval = m.status !== "proposed" && m.status !== "rejected";
  if (needsApproval && m.approvals.length === 0) addIssue(ctx, ["approvals"], `status ${m.status} requires a human approval`);
  const wasActivated = m.status === "active" || m.status === "suspended" || m.status === "exhausted";
  if (wasActivated && m.registry === null) addIssue(ctx, ["registry"], `status ${m.status} requires on-chain registry evidence`);
  if (m.proposedBy.type === "agent") addIssue(ctx, ["proposedBy"], "an agent may not propose its own mandate");
});
export type Mandate = z.infer<typeof MandateSchema>;

export const DelegationSchema = z.object({
  id: IdSchemas.delegation,
  companyId: IdSchemas.company,
  mandateId: IdSchemas.mandate,
  agentId: IdSchemas.agent,
  grantedBy: IdSchemas.user,
  taskTypes: z.array(Slug).min(1).max(32),
  status: z.enum(["active", "revoked", "expired"]),
  expiresAt: IsoTimestamp,
  revokedAt: IsoTimestamp.nullable(),
  ...mutable,
}).strict().superRefine((d, ctx) => {
  orderedTimes(d, ctx);
  if (d.status === "revoked" && d.revokedAt === null) addIssue(ctx, ["revokedAt"], "revoked delegation requires revokedAt");
  if (d.status !== "revoked" && d.revokedAt !== null) addIssue(ctx, ["revokedAt"], "revokedAt only valid when status is revoked");
});
export type Delegation = z.infer<typeof DelegationSchema>;

/* ------------------------------------------------------------------ Spending */

export const SpendIntentSchema = z.object({
  id: IdSchemas.spendIntent,
  companyId: IdSchemas.company,
  agentId: IdSchemas.agent,
  mandateId: IdSchemas.mandate,
  counterpartyId: IdSchemas.counterparty,
  taskId: IdSchemas.task,
  obligationId: IdSchemas.obligation.nullable(),
  amount: MoneySchema,
  purpose: text(200),
  /** Caller-supplied; (agentId, idempotencyKey) must be unique so retries never double-spend. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  status: z.enum(SPEND_INTENT_STATUSES),
  policyDecisionId: IdSchemas.policyDecision.nullable(),
  ...mutable,
}).strict().superRefine((s, ctx) => {
  orderedTimes(s, ctx);
  const needsDecision = ["pending_human_approval", "approved", "blocked", "submitted", "settled", "failed"].includes(s.status);
  if (needsDecision && s.policyDecisionId === null) addIssue(ctx, ["policyDecisionId"], `status ${s.status} requires a PolicyDecision`);
  if (s.amount.amountMinor === "0") addIssue(ctx, ["amount"], "spend amount must be greater than zero");
});
export type SpendIntent = z.infer<typeof SpendIntentSchema>;

export const POLICY_REASON_CODES = [
  "WITHIN_MANDATE",
  "MANDATE_NOT_ACTIVE",
  "MANDATE_EXPIRED",
  "AGENT_MISMATCH",
  "COUNTERPARTY_MISMATCH",
  "CURRENCY_MISMATCH",
  "DELEGATION_INVALID",
  "EXCEEDS_PER_TRANSACTION_LIMIT",
  "EXCEEDS_PERIOD_LIMIT",
  "EXCEEDS_TOTAL_LIMIT",
  "BUDGET_EXHAUSTED",
  "HUMAN_APPROVAL_REQUIRED",
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export const PolicyDecisionSchema = z.object({
  id: IdSchemas.policyDecision,
  companyId: IdSchemas.company,
  spendIntentId: IdSchemas.spendIntent,
  mandateId: IdSchemas.mandate,
  outcome: z.enum(POLICY_OUTCOMES),
  reasons: z.array(z.object({
    code: z.enum(POLICY_REASON_CODES),
    severity: z.enum(["info", "violation"]),
    message: text(240),
  }).strict()).min(1),
  evaluatedAt: IsoTimestamp,
  /** Decisions come from deterministic code only. An LLM cannot be recorded as the evaluator. */
  evaluator: z.object({ kind: z.literal("deterministic_policy_engine"), version: text(40) }).strict(),
  inputsCommitment: HashCommitment,
}).strict().superRefine((p, ctx) => {
  const violations = p.reasons.filter((r) => r.severity === "violation").length;
  if (p.outcome === "allow" && violations > 0) addIssue(ctx, ["reasons"], "an allow decision cannot carry violations");
  if (p.outcome === "deny" && violations === 0) addIssue(ctx, ["reasons"], "a deny decision must name at least one violation");
  if (p.outcome === "require_human_approval" && !p.reasons.some((r) => r.code === "HUMAN_APPROVAL_REQUIRED")) addIssue(ctx, ["reasons"], "escalation must cite HUMAN_APPROVAL_REQUIRED");
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const TransactionSchema = z.object({
  id: IdSchemas.transaction,
  companyId: IdSchemas.company,
  spendIntentId: IdSchemas.spendIntent,
  chain: z.literal("solana"),
  /** Devnet/localnet only in this build. Mainnet is not representable. */
  cluster: z.enum(["devnet", "localnet"]),
  status: z.enum(["built", "submitted", "confirmed", "failed"]),
  signature: SolanaSignature.nullable(),
  fromAddress: SolanaAddress,
  toAddress: SolanaAddress,
  assetMint: SolanaAddress,
  amount: MoneySchema,
  slot: z.number().int().min(0).nullable(),
  ...mutable,
}).strict().superRefine((t, ctx) => {
  orderedTimes(t, ctx);
  if ((t.status === "submitted" || t.status === "confirmed") && t.signature === null) addIssue(ctx, ["signature"], `status ${t.status} requires a signature`);
  if (t.status === "confirmed" && t.slot === null) addIssue(ctx, ["slot"], "confirmed transaction requires a slot");
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const SettlementSchema = z.object({
  id: IdSchemas.settlement,
  companyId: IdSchemas.company,
  transactionId: IdSchemas.transaction,
  spendIntentId: IdSchemas.spendIntent,
  mandateId: IdSchemas.mandate,
  contractId: IdSchemas.contract,
  obligationId: IdSchemas.obligation.nullable(),
  agentId: IdSchemas.agent,
  taskId: IdSchemas.task,
  counterpartyId: IdSchemas.counterparty,
  settledAmount: MoneySchema,
  status: z.enum(SETTLEMENT_STATUSES),
  confirmedAt: IsoTimestamp.nullable(),
  finalizedAt: IsoTimestamp.nullable(),
  reconciledAt: IsoTimestamp.nullable(),
  failureReason: text(300).nullable(),
  ...mutable,
}).strict().superRefine((s, ctx) => {
  orderedTimes(s, ctx);
  const confirmedOn = s.status === "confirmed" || s.status === "finalized" || s.status === "reconciled";
  if (confirmedOn && s.confirmedAt === null) addIssue(ctx, ["confirmedAt"], `status ${s.status} requires confirmedAt`);
  if ((s.status === "finalized" || s.status === "reconciled") && s.finalizedAt === null) addIssue(ctx, ["finalizedAt"], `status ${s.status} requires finalizedAt`);
  if (s.status === "reconciled" && s.reconciledAt === null) addIssue(ctx, ["reconciledAt"], "reconciled settlement requires reconciledAt");
  if (s.status === "failed" && s.failureReason === null) addIssue(ctx, ["failureReason"], "failed settlement requires failureReason");
  if (s.status !== "failed" && s.failureReason !== null) addIssue(ctx, ["failureReason"], "failureReason only valid when failed");
});
export type Settlement = z.infer<typeof SettlementSchema>;

/* ------------------------------------------------------------------ Accounting */

export const LEDGER_ACCOUNTS = [
  "treasury_cash", "accounts_payable", "prepaid_expense", "compute_expense", "other_expense", "revenue", "receivable",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/** One balanced line: debitAccount and creditAccount for the same positive amount. Append-only; fix via reversal. */
export const LedgerEntrySchema = z.object({
  id: IdSchemas.ledgerEntry,
  companyId: IdSchemas.company,
  /** Strictly increasing per company; gaps indicate tampering. */
  sequence: z.number().int().min(1),
  debitAccount: z.enum(LEDGER_ACCOUNTS),
  creditAccount: z.enum(LEDGER_ACCOUNTS),
  amount: MoneySchema,
  postedAt: IsoTimestamp,
  links: z.object({
    contractId: IdSchemas.contract.nullable(),
    obligationId: IdSchemas.obligation.nullable(),
    mandateId: IdSchemas.mandate.nullable(),
    agentId: IdSchemas.agent.nullable(),
    taskId: IdSchemas.task.nullable(),
    settlementId: IdSchemas.settlement.nullable(),
  }).strict(),
  reverses: IdSchemas.ledgerEntry.nullable(),
  memo: text(200),
}).strict().superRefine((e, ctx) => {
  if (e.debitAccount === e.creditAccount) addIssue(ctx, ["creditAccount"], "debit and credit accounts must differ");
  if (e.amount.amountMinor === "0") addIssue(ctx, ["amount"], "ledger amount must be greater than zero");
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const ScenarioSchema = z.object({
  id: IdSchemas.scenario,
  companyId: IdSchemas.company,
  name: text(120),
  kind: z.enum(["baseline", "contract_impact", "custom"]),
  /** Obligations the twin should layer on top of baseline. Empty for a baseline. */
  includedObligationIds: z.array(IdSchemas.obligation),
  assumptions: z.object({
    startMonth: YearMonth,
    horizonMonths: z.number().int().min(1).max(60),
    openingCash: SignedMoneySchema,
    monthlyRevenue: MoneySchema,
    monthlyOperatingCosts: MoneySchema,
  }).strict(),
  createdBy: ActorSchema,
  createdAt: IsoTimestamp,
}).strict().superRefine((s, ctx) => {
  const c = s.assumptions.openingCash.currency;
  if (s.assumptions.monthlyRevenue.currency !== c || s.assumptions.monthlyOperatingCosts.currency !== c) addIssue(ctx, ["assumptions"], "scenario amounts must share one currency");
  if (s.kind === "baseline" && s.includedObligationIds.length > 0) addIssue(ctx, ["includedObligationIds"], "a baseline scenario includes no obligations");
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/** Result of FluxTwin's deterministic calculation. FluxGraph only validates arithmetic consistency; it does not calculate. */
export const ForecastSchema = z.object({
  id: IdSchemas.forecast,
  companyId: IdSchemas.company,
  scenarioId: IdSchemas.scenario,
  engineVersion: text(40),
  calculatedAt: IsoTimestamp,
  /** Digest of the exact inputs, so a forecast can be proven reproducible. */
  inputsCommitment: HashCommitment,
  currency: Currency,
  points: z.array(z.object({
    month: YearMonth,
    openingCash: SignedMoneySchema,
    inflow: MoneySchema,
    outflow: MoneySchema,
    closingCash: SignedMoneySchema,
  }).strict()).min(1).max(60),
  /** Whole months until cash first reaches zero; null = not depleted within the horizon. */
  runwayMonths: z.number().int().min(0).nullable(),
}).strict().superRefine((f, ctx) => {
  f.points.forEach((p, i) => {
    if ([p.openingCash.currency, p.inflow.currency, p.outflow.currency, p.closingCash.currency].some((c) => c !== f.currency)) {
      addIssue(ctx, ["points", i], "point currency differs from forecast currency");
      return;
    }
    const expected = BigInt(p.openingCash.amountMinor) + BigInt(p.inflow.amountMinor) - BigInt(p.outflow.amountMinor);
    if (expected !== BigInt(p.closingCash.amountMinor)) addIssue(ctx, ["points", i, "closingCash"], "closingCash must equal openingCash + inflow - outflow");
    const prev = f.points[i - 1];
    if (prev) {
      if (p.openingCash.amountMinor !== prev.closingCash.amountMinor) addIssue(ctx, ["points", i, "openingCash"], "openingCash must equal previous closingCash");
      if (p.month !== addMonths(prev.month, 1)) addIssue(ctx, ["points", i, "month"], "months must be consecutive");
    }
  });
});
export type Forecast = z.infer<typeof ForecastSchema>;

export const TaskEconomicsSchema = z.object({
  id: IdSchemas.taskEconomics,
  companyId: IdSchemas.company,
  taskId: IdSchemas.task,
  agentId: IdSchemas.agent,
  contractId: IdSchemas.contract.nullable(),
  spendIntentIds: z.array(IdSchemas.spendIntent),
  settlementIds: z.array(IdSchemas.settlement),
  totalCost: MoneySchema,
  attributedRevenue: MoneySchema.nullable(),
  asOf: IsoTimestamp,
}).strict().superRefine((t, ctx) => {
  if (t.attributedRevenue && t.attributedRevenue.currency !== t.totalCost.currency) addIssue(ctx, ["attributedRevenue"], "revenue and cost must share one currency");
});
export type TaskEconomics = z.infer<typeof TaskEconomicsSchema>;

/* ------------------------------------------------------------------ Audit */

export const AuditEventSchema = z.object({
  id: IdSchemas.auditEvent,
  companyId: IdSchemas.company,
  /** 1-based, gapless per company. */
  sequence: z.number().int().min(1),
  domainEventId: IdSchemas.event,
  eventType: z.string().min(1).max(60),
  actor: ActorSchema,
  subject: z.object({ type: z.string().min(1).max(40), id: z.string().min(1).max(60) }).strict(),
  occurredAt: IsoTimestamp,
  /** Hash of the previous audit event for this company; null only for sequence 1. */
  prevHash: HashCommitment.nullable(),
  hash: HashCommitment,
}).strict().superRefine((a, ctx) => {
  if ((a.sequence === 1) !== (a.prevHash === null)) addIssue(ctx, ["prevHash"], "prevHash must be null exactly when sequence is 1");
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
