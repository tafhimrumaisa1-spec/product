import { aiModelActor, humanActor, agentActor, systemActor, type Actor } from "./actor";
import { buildAuditChain } from "./audit";
import { commit, digest } from "./commitments";
import {
  AgentSchema, BudgetSchema, CompanySchema, ContractSchema, ContractVersionSchema, CounterpartySchema, DelegationSchema,
  EvidenceCitationSchema, ExtractedTermsSchema, ForecastSchema, HumanUserSchema, LedgerEntrySchema, MandateSchema,
  ObligationSchema, OrganizationSchema, PolicyDecisionSchema, ScenarioSchema, SettlementSchema, SpendIntentSchema,
  TaskEconomicsSchema, TransactionSchema, type Forecast, type LedgerEntry, type Obligation, type Scenario,
} from "./entities";
import { createEvent, LIFECYCLE_SUBJECT_KINDS, type DomainEvent, type EventBody } from "./events";
import type { DomainEventType } from "./eventTypes";
import { sha256Bytes, utf8Encode } from "./hash";
import { deriveId, type EventId, type IdKind } from "./ids";
import {
  advanceContract, advanceMandate, advanceObligation, advanceSettlement, advanceSpendIntent,
} from "./lifecycle/advance";
import { money, signedMoney } from "./money";
import type { GraphSnapshot } from "./graph";
import { addMonths, type Money } from "./primitives";
import { SCHEMA_VERSION } from "./primitives";
import type { Result } from "./result";

/**
 * Synthetic, deterministic fixture: the "Golden Demo" as data.
 * Everything here is invented. Addresses and signatures are deterministic placeholders derived from hashes,
 * NOT real keys, NOT real transactions. The salt below is a public test salt, never use it for real commitments.
 * The fixture is built by driving the real state machines, so it can never drift from the lifecycle rules.
 */
export const FIXTURE_SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NS = "fluxgraph-fixture/v1";
const fid = <K extends IdKind>(kind: K, name: string) => deriveId(kind, NS, name);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Deterministic base58-shaped placeholder. Not a valid keypair or signature on any network. */
export function syntheticBase58(seed: string, length: number): string {
  let out = "";
  for (let i = 0; out.length < length; i++) {
    for (const b of sha256Bytes(utf8Encode(`${NS}:${seed}:${i}`))) if (out.length < length) out += B58[b % 58];
  }
  return out;
}
const addr = (seed: string) => syntheticBase58(`addr:${seed}`, 44);
const sig = (seed: string) => syntheticBase58(`sig:${seed}`, 88);

const usdc = (whole: number): Money => money(BigInt(whole) * 1_000_000n, "USDC");
const must = <T>(r: Result<T>): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

export interface FixtureBundle {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly graph: GraphSnapshot;
  /** Immutable domain events in causal order. */
  readonly events: readonly DomainEvent[];
  /** Named handles for tests and demos. */
  readonly ids: Readonly<Record<string, string>>;
}

export function buildFixture(): FixtureBundle {
  /* ------------------------------------------------------------ clock: one tick = one minute */
  const BASE = Date.UTC(2026, 9, 5, 9, 0, 0);
  let tick = 0;
  const now = (): string => new Date(BASE + tick++ * 60_000).toISOString().replace(".000Z", "Z");

  /* ------------------------------------------------------------ tenancy, people, agent, vendor */
  const t0 = now();
  const organization = OrganizationSchema.parse({ id: fid("organization", "org"), name: "Halcyon Group (synthetic)", environment: "synthetic", createdAt: t0 });
  const company = CompanySchema.parse({ id: fid("company", "halcyon-freight"), organizationId: organization.id, legalName: "Halcyon Freight Robotics Ltd (synthetic)", baseCurrency: "USDC", countryCode: "GB", createdAt: t0 });
  const maya = HumanUserSchema.parse({ id: fid("user", "maya"), organizationId: organization.id, displayName: "Maya Okafor", email: "maya.okafor@halcyon.example", roles: ["owner", "finance_approver"], status: "active", createdAt: t0 });
  const jonas = HumanUserSchema.parse({ id: fid("user", "jonas"), organizationId: organization.id, displayName: "Jonas Lindqvist", email: "jonas.lindqvist@halcyon.example", roles: ["legal_reviewer"], status: "active", createdAt: t0 });
  const agent = AgentSchema.parse({ id: fid("agent", "compute-procurement"), companyId: company.id, name: "Compute Procurement Agent", ownerUserId: maya.id, walletAddress: addr("agent-wallet"), holdsTreasuryKey: false, status: "active", revision: 1, createdAt: t0, updatedAt: t0 });
  const vendor = CounterpartySchema.parse({ id: fid("counterparty", "basalt"), companyId: company.id, legalName: "Basalt Compute Ltd (synthetic)", kind: "vendor", payoutAddress: addr("basalt-payout"), verification: "verified", createdAt: t0 });

  /* ------------------------------------------------------------ the contract (documents stay private) */
  const terms = ExtractedTermsSchema.parse({
    vendorName: vendor.legalName,
    totalContractValue: usdc(120_000),
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    durationMonths: 12,
    periodicCap: { amount: usdc(12_000), period: "monthly" },
    paymentSchedule: Array.from({ length: 12 }, (_, i) => ({ dueDate: `${addMonths("2026-10", i)}-01`, amount: usdc(10_000), description: `Monthly compute reservation ${i + 1}/12` })),
    renewal: { autoRenew: true, noticeDays: 60, renewalTermMonths: 12 },
    termination: { noticeDays: 30, forCauseAllowed: true, earlyTerminationFee: usdc(5_000) },
  });
  const model = { provider: "fluxcontracts", model: "synthetic-extractor", promptVersion: "p1" };
  const modelActor = aiModelActor("fluxcontracts/synthetic-extractor-1");
  const flows = systemActor("fluxflow");
  const contractSvc = systemActor("fluxcontracts");
  const mandateSvc = systemActor("fluxmandate");
  const twinSvc = systemActor("fluxtwin");
  const ledgerSvc = systemActor("fluxledger");

  const tUpload = now();
  const contractId = fid("contract", "basalt-compute-2026");
  const versionId = fid("contractVersion", "basalt-compute-2026/v1");
  let contract = ContractSchema.parse({ id: contractId, companyId: company.id, counterpartyId: vendor.id, title: "Compute Services Agreement (synthetic)", status: "uploaded", currentVersionId: versionId, revision: 1, createdAt: tUpload, updatedAt: tUpload });

  const citationSpecs = [
    { key: "payment", termPath: "paymentSchedule", page: 2, start: 1180, end: 1320, excerpt: "Customer shall pay Provider 10,000 USDC on the first day of each calendar month for twelve consecutive months. (SYNTHETIC)" },
    { key: "cap", termPath: "periodicCap.amount", page: 3, start: 210, end: 340, excerpt: "In no calendar month shall fees invoiced exceed 12,000 USDC without written amendment. (SYNTHETIC)" },
    { key: "renewal", termPath: "renewal.noticeDays", page: 5, start: 640, end: 760, excerpt: "This Agreement renews for successive twelve-month terms unless either party gives sixty days notice. (SYNTHETIC)" },
    { key: "termination", termPath: "termination.noticeDays", page: 5, start: 900, end: 1010, excerpt: "Either party may terminate on thirty days written notice subject to the early termination fee. (SYNTHETIC)" },
  ] as const;
  const citations = citationSpecs.map((c) => EvidenceCitationSchema.parse({
    id: fid("citation", c.key), companyId: company.id, contractVersionId: versionId, termPath: c.termPath, pageNumber: c.page,
    startOffset: c.start, endOffset: c.end, excerpt: c.excerpt, excerptCommitment: commit(c.excerpt, FIXTURE_SALT),
    confidence: 0.97, extractedBy: model, createdAt: tUpload,
  }));
  const citationIds = citations.map((c) => c.id);
  const termsCommitment = commit(terms, FIXTURE_SALT);

  const events: DomainEvent[] = [];
  let last: EventId | null = null;
  const emit = <T extends DomainEventType>(type: T, correlationId: string, body: Omit<EventBody<T>, "companyId" | "correlationId" | "causationId">): void => {
    const e = createEvent(type, { ...body, companyId: company.id, correlationId, causationId: last } as unknown as EventBody<T>);
    events.push(e);
    last = e.eventId;
  };
  const lifecycle = (corr: string, kind: (typeof LIFECYCLE_SUBJECT_KINDS)[number], subjectId: string, machine: "Contract" | "Obligation" | "Mandate" | "SpendIntent" | "Settlement", t: { from: string; to: string; trigger: string }, actor: Actor, at: string): void =>
    emit("LifecycleTransitioned", corr, { occurredAt: at, actor, subject: { type: kind, id: subjectId }, payload: { machine, from: t.from, to: t.to, trigger: t.trigger } } as never);

  const C1 = "onboard-basalt-compute-001";
  emit("ContractUploaded", C1, {
    occurredAt: tUpload, actor: humanActor(maya.id), subject: { type: "contract", id: contractId },
    payload: { contractVersionId: versionId, counterpartyId: vendor.id, documentCommitment: commit("SYNTHETIC CONTRACT DOCUMENT BYTES", FIXTURE_SALT), versionNumber: 1 },
  });

  let at = now();
  let adv = must(advanceContract(contract, "START_EXTRACTION", { actor: contractSvc, at }));
  contract = adv.entity;
  lifecycle(C1, "contract", contractId, "Contract", adv.transition, contractSvc, at);

  at = now();
  adv = must(advanceContract(contract, "EXTRACTION_SUCCEEDED", { actor: contractSvc, at, extractedTermsPresent: true }));
  contract = adv.entity;
  const version = ContractVersionSchema.parse({
    id: versionId, contractId, companyId: company.id, versionNumber: 1,
    documentCommitment: commit("SYNTHETIC CONTRACT DOCUMENT BYTES", FIXTURE_SALT),
    documentRef: "vault://synthetic/contracts/basalt-compute-2026-v1.pdf", mediaType: "application/pdf", uploadedBy: maya.id, uploadedAt: tUpload,
    extraction: { status: "succeeded", model, terms, termsCommitment, extractedAt: at, failureReason: null },
  });
  emit("TermsExtracted", C1, { occurredAt: at, actor: modelActor, subject: { type: "contract", id: contractId }, payload: { contractVersionId: versionId, termsCommitment, citationIds, model } });

  /* ------------------------------------------------------------ obligations: AI proposes, humans approve */
  const obligationSpecs = [
    { key: "payment", kind: "payment", description: "Pay 10,000 USDC monthly for 12 months (120,000 USDC total)", amount: usdc(120_000), period: null, dueDate: "2026-10-01", noticeDays: null, cit: "payment" },
    { key: "cap", kind: "periodic_cap", description: "Monthly invoiced fees capped at 12,000 USDC", amount: usdc(12_000), period: "monthly", dueDate: null, noticeDays: null, cit: "cap" },
    { key: "renewal", kind: "renewal_notice", description: "Auto-renews for 12 months unless 60 days notice given", amount: null, period: null, dueDate: "2027-08-01", noticeDays: 60, cit: "renewal" },
    { key: "termination", kind: "termination_notice", description: "30 days notice to terminate; 5,000 USDC early termination fee", amount: usdc(5_000), period: null, dueDate: null, noticeDays: 30, cit: "termination" },
  ] as const;
  const tProposed = now();
  let obligations: Obligation[] = obligationSpecs.map((o) => ObligationSchema.parse({
    id: fid("obligation", o.key), companyId: company.id, contractId, contractVersionId: versionId, counterpartyId: vendor.id,
    kind: o.kind, description: o.description, material: true, amount: o.amount, period: o.period, dueDate: o.dueDate, noticeDays: o.noticeDays,
    citationIds: [fid("citation", o.cit)], source: "ai_extracted", status: "proposed", review: null,
    revision: 1, createdAt: tProposed, updatedAt: tProposed,
  }));
  for (const o of obligations) {
    emit("ObligationProposed", C1, { occurredAt: tProposed, actor: modelActor, subject: { type: "obligation", id: o.id }, payload: { contractId, contractVersionId: versionId, kind: o.kind, citationIds: o.citationIds } });
  }

  at = now();
  adv = must(advanceContract(contract, "BEGIN_REVIEW", { actor: humanActor(jonas.id), at }));
  contract = adv.entity;
  lifecycle(C1, "contract", contractId, "Contract", adv.transition, humanActor(jonas.id), at);

  obligations = obligations.map((o) => {
    const when = now();
    const r = must(advanceObligation(o, "APPROVE", { actor: humanActor(jonas.id), at: when, citationCount: o.citationIds.length }));
    emit("ObligationApproved", C1, { occurredAt: when, actor: humanActor(jonas.id), subject: { type: "obligation", id: o.id }, payload: { contractId, approvedBy: jonas.id } });
    return r.entity;
  });

  at = now();
  adv = must(advanceContract(contract, "APPROVE", { actor: humanActor(maya.id), at, materialObligationCount: obligations.length, unapprovedMaterialObligationCount: 0 }));
  contract = adv.entity;
  emit("ContractActivated", C1, { occurredAt: at, actor: humanActor(maya.id), subject: { type: "contract", id: contractId }, payload: { contractVersionId: versionId, approvedObligationIds: obligations.map((o) => o.id) } });

  obligations = obligations.map((o) => {
    const when = now();
    const r = must(advanceObligation(o, "ACTIVATE", { actor: contractSvc, at: when, contractStatus: contract.status }));
    lifecycle(C1, "obligation", o.id, "Obligation", r.transition, contractSvc, when);
    return r.entity;
  });
  const paymentObligation = obligations[0]!;

  /* ------------------------------------------------------------ FluxTwin: baseline vs with-contract (illustrative arithmetic) */
  const scenarioTime = now();
  const mkScenario = (name: string, kind: Scenario["kind"], included: readonly Obligation[]): Scenario => ScenarioSchema.parse({
    id: fid("scenario", name), companyId: company.id, name, kind, includedObligationIds: included.map((o) => o.id),
    assumptions: { startMonth: "2026-10", horizonMonths: 12, openingCash: signedMoney(150_000n * 1_000_000n, "USDC"), monthlyRevenue: usdc(40_000), monthlyOperatingCosts: usdc(45_000) },
    createdBy: twinSvc, createdAt: scenarioTime,
  });
  const baselineScenario = mkScenario("baseline", "baseline", []);
  const impactScenario = mkScenario("with-basalt-contract", "contract_impact", [paymentObligation]);

  /** Fixture-only illustration of what FluxTwin will calculate. FluxTwin owns the real engine. */
  const mkForecast = (s: Scenario, extraMonthly: bigint, label: string, calculatedAt: string): Forecast => {
    let cash = BigInt(s.assumptions.openingCash.amountMinor);
    let runway: number | null = null;
    const points = Array.from({ length: s.assumptions.horizonMonths }, (_, i) => {
      const inflow = BigInt(s.assumptions.monthlyRevenue.amountMinor);
      const outflow = BigInt(s.assumptions.monthlyOperatingCosts.amountMinor) + extraMonthly;
      const opening = cash;
      cash = opening + inflow - outflow;
      if (runway === null && cash <= 0n) runway = i + 1;
      return { month: addMonths(s.assumptions.startMonth, i), openingCash: signedMoney(opening, "USDC"), inflow: money(inflow, "USDC"), outflow: money(outflow, "USDC"), closingCash: signedMoney(cash, "USDC") };
    });
    return ForecastSchema.parse({
      id: fid("forecast", label), companyId: company.id, scenarioId: s.id, engineVersion: "fixture-0", calculatedAt,
      inputsCommitment: digest("forecast-inputs", { scenario: s.assumptions, extraMonthly: extraMonthly.toString() }), currency: "USDC", points, runwayMonths: runway,
    });
  };
  const tCalc = now();
  const baselineForecast = mkForecast(baselineScenario, 0n, "baseline", tCalc);
  const impactForecast = mkForecast(impactScenario, 10_000n * 1_000_000n, "with-basalt-contract", tCalc);
  for (const [s, f] of [[baselineScenario, baselineForecast], [impactScenario, impactForecast]] as const) {
    emit("ScenarioCalculated", C1, { occurredAt: tCalc, actor: twinSvc, subject: { type: "scenario", id: s.id }, payload: { forecastId: f.id, runwayMonths: f.runwayMonths, inputsCommitment: f.inputsCommitment, engineVersion: f.engineVersion } });
  }
  emit("TwinUpdated", C1, { occurredAt: tCalc, actor: twinSvc, subject: { type: "company", id: company.id }, payload: { forecastId: impactForecast.id, scenarioId: impactScenario.id, cause: "contract_activated", runwayMonths: impactForecast.runwayMonths } });

  /* ------------------------------------------------------------ authority: budget, mandate, delegation */
  const tBudget = now();
  const budget = BudgetSchema.parse({ id: fid("budget", "compute-fy26-27"), companyId: company.id, name: "Compute FY26/27", scope: "contract", contractId, agentId: null, periodStart: "2026-10-01", periodEnd: "2027-09-30", limit: usdc(120_000), status: "active", createdBy: maya.id, revision: 1, createdAt: tBudget, updatedAt: tBudget });

  const M1 = "mandate-basalt-compute-001";
  const tMandate = now();
  const limits = { perTransaction: usdc(10_000), perPeriod: { amount: usdc(12_000), period: "monthly" as const }, total: usdc(120_000) };
  const mandateTermsCommitment = commit({ limits, contractId, delegateAgentId: agent.id }, FIXTURE_SALT);
  let mandate = MandateSchema.parse({
    id: fid("mandate", "basalt-compute"), companyId: company.id, contractId, obligationIds: obligations.map((o) => o.id), counterpartyId: vendor.id,
    delegateAgentId: agent.id, budgetId: budget.id, limits, requireHumanApprovalAbove: null,
    validFrom: "2026-10-05T00:00:00Z", validUntil: "2027-09-30T23:59:59Z", termsCommitment: mandateTermsCommitment,
    proposedBy: mandateSvc, approvals: [], registry: null, status: "proposed", revision: 1, createdAt: tMandate, updatedAt: tMandate,
  });
  emit("MandateProposed", M1, { occurredAt: tMandate, actor: mandateSvc, subject: { type: "mandate", id: mandate.id }, payload: { contractId, delegateAgentId: agent.id, obligationIds: mandate.obligationIds, termsCommitment: mandateTermsCommitment } });

  at = now();
  mandate = must(advanceMandate(mandate, "APPROVE", { actor: humanActor(maya.id), at, linkedObligationsApproved: obligations.every((o) => o.review?.decision === "approved") })).entity;
  emit("MandateApproved", M1, { occurredAt: at, actor: humanActor(maya.id), subject: { type: "mandate", id: mandate.id }, payload: { approvedBy: maya.id } });

  at = now();
  const registry = { network: "solana-devnet" as const, authorityAccount: addr("mandate-authority"), authorityStateCommitment: digest("authority-state", { mandate: mandate.id, termsCommitment: mandateTermsCommitment, status: "active" }), registrationSignature: sig("mandate-registration"), registeredAt: at };
  mandate = must(advanceMandate(mandate, "ACTIVATE", { actor: mandateSvc, at, registry })).entity;
  emit("MandateActivated", M1, { occurredAt: at, actor: mandateSvc, subject: { type: "mandate", id: mandate.id }, payload: { authorityStateCommitment: registry.authorityStateCommitment, registrationSignature: registry.registrationSignature } });

  const delegation = DelegationSchema.parse({ id: fid("delegation", "basalt-compute-agent"), companyId: company.id, mandateId: mandate.id, agentId: agent.id, grantedBy: maya.id, taskTypes: ["compute-procurement", "invoice-payment"], status: "active", expiresAt: mandate.validUntil, revokedAt: null, revision: 1, createdAt: at, updatedAt: at });

  /* ------------------------------------------------------------ Spend A: authorized, paid, reconciled */
  const taskA = fid("task", "route-optimisation-batch-17");
  const S1 = "spend-a-invoice-oct-001";
  const tReqA = now();
  let intentA = SpendIntentSchema.parse({ id: fid("spendIntent", "A"), companyId: company.id, agentId: agent.id, mandateId: mandate.id, counterpartyId: vendor.id, taskId: taskA, obligationId: paymentObligation.id, amount: usdc(8_500), purpose: "Pay October compute invoice (synthetic)", idempotencyKey: "inv-oct-0001", status: "requested", policyDecisionId: null, revision: 1, createdAt: tReqA, updatedAt: tReqA });
  emit("SpendRequested", S1, { occurredAt: tReqA, actor: agentActor(agent.id), subject: { type: "spendIntent", id: intentA.id }, payload: { mandateId: mandate.id, agentId: agent.id, counterpartyId: vendor.id, taskId: taskA, amount: intentA.amount } });

  at = now();
  const evalA = must(advanceSpendIntent(intentA, "BEGIN_EVALUATION", { actor: flows, at }));
  intentA = evalA.entity;
  lifecycle(S1, "spendIntent", intentA.id, "SpendIntent", evalA.transition, flows, at);

  const tDecA = now();
  const decisionA = PolicyDecisionSchema.parse({
    id: fid("policyDecision", "A"), companyId: company.id, spendIntentId: intentA.id, mandateId: mandate.id, outcome: "allow",
    reasons: [{ code: "WITHIN_MANDATE", severity: "info", message: "8,500 USDC is within the per-transaction, monthly and total limits." }],
    evaluatedAt: tDecA, evaluator: { kind: "deterministic_policy_engine", version: "fixture-0" },
    inputsCommitment: digest("policy-inputs", { intent: intentA.id, mandate: mandate.id, amount: intentA.amount }),
  });
  intentA = must(advanceSpendIntent(intentA, "ALLOW", { actor: mandateSvc, at: tDecA, policyDecisionId: decisionA.id, policyOutcome: decisionA.outcome })).entity;
  emit("SpendApproved", S1, { occurredAt: tDecA, actor: mandateSvc, subject: { type: "spendIntent", id: intentA.id }, payload: { policyDecisionId: decisionA.id, mandateId: mandate.id, amount: intentA.amount, decidedBy: "policy_engine" } });

  const tSubmit = now();
  const signatureA = sig("payment-A");
  intentA = must(advanceSpendIntent(intentA, "SUBMIT", { actor: flows, at: tSubmit, hasTransaction: true })).entity;
  emit("SpendSubmitted", S1, { occurredAt: tSubmit, actor: flows, subject: { type: "spendIntent", id: intentA.id }, payload: { transactionId: fid("transaction", "A"), signature: signatureA } });

  const tConfirm = now();
  const transaction = TransactionSchema.parse({ id: fid("transaction", "A"), companyId: company.id, spendIntentId: intentA.id, chain: "solana", cluster: "devnet", status: "confirmed", signature: signatureA, fromAddress: addr("treasury-vault"), toAddress: vendor.payoutAddress, assetMint: addr("devnet-usdc-mint"), amount: intentA.amount, slot: 412_345_678, revision: 3, createdAt: tSubmit, updatedAt: tConfirm });
  let settlement = SettlementSchema.parse({ id: fid("settlement", "A"), companyId: company.id, transactionId: transaction.id, spendIntentId: intentA.id, mandateId: mandate.id, contractId, obligationId: paymentObligation.id, agentId: agent.id, taskId: taskA, counterpartyId: vendor.id, settledAmount: intentA.amount, status: "pending", confirmedAt: null, finalizedAt: null, reconciledAt: null, failureReason: null, revision: 1, createdAt: tSubmit, updatedAt: tSubmit });
  settlement = must(advanceSettlement(settlement, "CONFIRM", { actor: flows, at: tConfirm, transactionSignaturePresent: true })).entity;
  emit("SettlementConfirmed", S1, { occurredAt: tConfirm, actor: flows, subject: { type: "settlement", id: settlement.id }, payload: { transactionId: transaction.id, spendIntentId: intentA.id, signature: signatureA, slot: 412_345_678, amount: settlement.settledAmount } });

  at = now();
  const settleA = must(advanceSpendIntent(intentA, "SETTLE", { actor: flows, at }));
  intentA = settleA.entity;
  lifecycle(S1, "spendIntent", intentA.id, "SpendIntent", settleA.transition, flows, at);
  at = now();
  const fin = must(advanceSettlement(settlement, "FINALIZE", { actor: flows, at }));
  settlement = fin.entity;
  lifecycle(S1, "settlement", settlement.id, "Settlement", fin.transition, flows, at);

  const links = { contractId, obligationId: paymentObligation.id, mandateId: mandate.id, agentId: agent.id, taskId: taskA, settlementId: settlement.id };
  const mkEntry = (seq: number, debit: LedgerEntry["debitAccount"], credit: LedgerEntry["creditAccount"], memo: string, postedAt: string): LedgerEntry => LedgerEntrySchema.parse({ id: fid("ledgerEntry", `A-${seq}`), companyId: company.id, sequence: seq, debitAccount: debit, creditAccount: credit, amount: intentA.amount, postedAt, links, reverses: null, memo });
  const tPost1 = now();
  const tPost2 = now();
  const ledgerEntries = [
    mkEntry(1, "compute_expense", "accounts_payable", "Accrue October compute invoice (synthetic)", tPost1),
    mkEntry(2, "accounts_payable", "treasury_cash", "Settle invoice from treasury on Solana devnet (synthetic)", tPost2),
  ];
  for (const e of ledgerEntries) {
    emit("LedgerEntryPosted", S1, { occurredAt: e.postedAt, actor: ledgerSvc, subject: { type: "ledgerEntry", id: e.id }, payload: { settlementId: settlement.id, debitAccount: e.debitAccount, creditAccount: e.creditAccount, amount: e.amount, contractId, obligationId: paymentObligation.id, mandateId: mandate.id, agentId: agent.id, taskId: taskA } });
  }
  at = now();
  settlement = must(advanceSettlement(settlement, "RECONCILE", { actor: ledgerSvc, at, amountMatchesIntent: true, ledgerEntriesPosted: ledgerEntries.length })).entity;
  emit("SettlementReconciled", S1, { occurredAt: at, actor: ledgerSvc, subject: { type: "settlement", id: settlement.id }, payload: { ledgerEntryIds: ledgerEntries.map((e) => e.id) } });

  const taskEconomics = TaskEconomicsSchema.parse({ id: fid("taskEconomics", "route-optimisation-batch-17"), companyId: company.id, taskId: taskA, agentId: agent.id, contractId, spendIntentIds: [intentA.id], settlementIds: [settlement.id], totalCost: settlement.settledAmount, attributedRevenue: usdc(31_000), asOf: at });
  emit("TaskEconomicsRecorded", S1, { occurredAt: at, actor: ledgerSvc, subject: { type: "taskEconomics", id: taskEconomics.id }, payload: { taskId: taskA, totalCost: taskEconomics.totalCost } });

  /* ------------------------------------------------------------ Spend B: exceeds the mandate, blocked */
  const S2 = "spend-b-oversize-001";
  const tReqB = now();
  let intentB = SpendIntentSchema.parse({ id: fid("spendIntent", "B"), companyId: company.id, agentId: agent.id, mandateId: mandate.id, counterpartyId: vendor.id, taskId: fid("task", "burst-training-run-03"), obligationId: paymentObligation.id, amount: usdc(25_000), purpose: "Prepay burst compute capacity (synthetic)", idempotencyKey: "burst-prepay-01", status: "requested", policyDecisionId: null, revision: 1, createdAt: tReqB, updatedAt: tReqB });
  emit("SpendRequested", S2, { occurredAt: tReqB, actor: agentActor(agent.id), subject: { type: "spendIntent", id: intentB.id }, payload: { mandateId: mandate.id, agentId: agent.id, counterpartyId: vendor.id, taskId: intentB.taskId, amount: intentB.amount } });
  at = now();
  const evalB = must(advanceSpendIntent(intentB, "BEGIN_EVALUATION", { actor: flows, at }));
  intentB = evalB.entity;
  lifecycle(S2, "spendIntent", intentB.id, "SpendIntent", evalB.transition, flows, at);
  const tDecB = now();
  const decisionB = PolicyDecisionSchema.parse({
    id: fid("policyDecision", "B"), companyId: company.id, spendIntentId: intentB.id, mandateId: mandate.id, outcome: "deny",
    reasons: [
      { code: "EXCEEDS_PER_TRANSACTION_LIMIT", severity: "violation", message: "25,000 USDC exceeds the 10,000 USDC per-transaction limit." },
      { code: "EXCEEDS_PERIOD_LIMIT", severity: "violation", message: "25,000 USDC exceeds the 12,000 USDC monthly limit." },
    ],
    evaluatedAt: tDecB, evaluator: { kind: "deterministic_policy_engine", version: "fixture-0" },
    inputsCommitment: digest("policy-inputs", { intent: intentB.id, mandate: mandate.id, amount: intentB.amount }),
  });
  intentB = must(advanceSpendIntent(intentB, "DENY", { actor: mandateSvc, at: tDecB, policyDecisionId: decisionB.id, policyOutcome: decisionB.outcome })).entity;
  emit("SpendBlocked", S2, { occurredAt: tDecB, actor: mandateSvc, subject: { type: "spendIntent", id: intentB.id }, payload: { policyDecisionId: decisionB.id, mandateId: mandate.id, amount: intentB.amount, reasonCodes: ["EXCEEDS_PER_TRANSACTION_LIMIT", "EXCEEDS_PERIOD_LIMIT"], decidedBy: "policy_engine" } });

  /* ------------------------------------------------------------ assemble */
  const graph: GraphSnapshot = {
    organizations: [organization], companies: [company], users: [maya, jonas], agents: [agent], counterparties: [vendor],
    contracts: [contract], contractVersions: [version], citations, obligations, budgets: [budget], mandates: [mandate], delegations: [delegation],
    spendIntents: [intentA, intentB], policyDecisions: [decisionA, decisionB], transactions: [transaction], settlements: [settlement],
    ledgerEntries, scenarios: [baselineScenario, impactScenario], forecasts: [baselineForecast, impactForecast], taskEconomics: [taskEconomics],
    auditEvents: buildAuditChain(events),
  };
  const ids = {
    organization: organization.id, company: company.id, maya: maya.id, jonas: jonas.id, agent: agent.id, vendor: vendor.id,
    contract: contractId, contractVersion: versionId, paymentObligation: paymentObligation.id, mandate: mandate.id, budget: budget.id,
    spendIntentAuthorized: intentA.id, spendIntentBlocked: intentB.id, decisionAllow: decisionA.id, decisionDeny: decisionB.id,
    transaction: transaction.id, settlement: settlement.id, taskAuthorized: taskA,
    scenarioBaseline: baselineScenario.id, scenarioWithContract: impactScenario.id,
  };
  return { schemaVersion: SCHEMA_VERSION, graph, events, ids };
}

let cached: FixtureBundle | undefined;
/** Memoised fixture. Built on first use so importing FluxGraph has no side effects. */
export const getFixture = (): FixtureBundle => (cached ??= buildFixture());

/** Lazy view over the memoised fixture (no work happens until a property is read). Tests also call buildFixture() to prove determinism. */
export const FIXTURE: FixtureBundle = {
  schemaVersion: SCHEMA_VERSION,
  get graph() { return getFixture().graph; },
  get events() { return getFixture().events; },
  get ids() { return getFixture().ids; },
};
