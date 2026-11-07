import { z } from "zod";
import { ActorSchema } from "./actor";
import { LEDGER_ACCOUNTS, ModelRefSchema, OBLIGATION_KINDS, POLICY_REASON_CODES } from "./entities";
import { FluxGraphError } from "./errors";
import { EVENT_TYPES, type DomainEventType } from "./eventTypes";
import { deriveId, IdSchemas, type EventId, type IdKind } from "./ids";
import { addIssue, HashCommitment, IsoTimestamp, MoneySchema, SolanaSignature } from "./primitives";
import { err, ok, type Result } from "./result";

/* ----------------------------------------------------------------------------------------------
 * Domain events are immutable facts. Rules:
 *  - Payloads carry ids, amounts, commitments and codes. NEVER contract text, excerpts, or secrets.
 *  - eventId is content-addressed (hash of the body), so re-creating the same event yields the same id.
 *  - Who may emit what is enforced in the schema (see superRefine below), not just by convention.
 * -------------------------------------------------------------------------------------------- */

const base = {
  eventId: IdSchemas.event,
  schemaVersion: z.literal(1),
  companyId: IdSchemas.company,
  occurredAt: IsoTimestamp,
  actor: ActorSchema,
  /** Groups every event in one business flow (e.g. one contract onboarding or one spend). */
  correlationId: z.string().regex(/^[a-z0-9][a-z0-9_-]{5,63}$/),
  /** The event that directly caused this one, if any. */
  causationId: IdSchemas.event.nullable(),
};

const ev = <T extends DomainEventType, K extends IdKind, I extends z.ZodTypeAny, P extends z.ZodRawShape>(
  type: T, subjectKind: K, subjectId: I, payload: P,
) => z.object({
  ...base,
  type: z.literal(type),
  subject: z.object({ type: z.literal(subjectKind), id: subjectId }).strict(),
  payload: z.object(payload).strict(),
}).strict();

const reasonCodes = z.array(z.enum(POLICY_REASON_CODES)).min(1);
const decidedBy = z.enum(["policy_engine", "human"]);

export const LIFECYCLE_SUBJECT_KINDS = ["contract", "obligation", "mandate", "spendIntent", "settlement"] as const;

const lifecycleTransitioned = z.object({
  ...base,
  type: z.literal("LifecycleTransitioned"),
  subject: z.object({ type: z.enum(LIFECYCLE_SUBJECT_KINDS), id: z.string().regex(/^[a-z]{3}_[0-9a-f]{24}$/) }).strict(),
  payload: z.object({
    machine: z.enum(["Contract", "Obligation", "Mandate", "SpendIntent", "Settlement"]),
    from: z.string().min(1).max(40),
    to: z.string().min(1).max(40),
    trigger: z.string().min(1).max(40),
  }).strict(),
}).strict();

const eventUnion = z.discriminatedUnion("type", [
  ev("ContractUploaded", "contract", IdSchemas.contract, {
    contractVersionId: IdSchemas.contractVersion, counterpartyId: IdSchemas.counterparty,
    documentCommitment: HashCommitment, versionNumber: z.number().int().min(1),
  }),
  ev("TermsExtracted", "contract", IdSchemas.contract, {
    contractVersionId: IdSchemas.contractVersion, termsCommitment: HashCommitment,
    citationIds: z.array(IdSchemas.citation).min(1), model: ModelRefSchema,
  }),
  ev("ExtractionFailed", "contract", IdSchemas.contract, {
    contractVersionId: IdSchemas.contractVersion, reason: z.string().min(1).max(300),
  }),
  ev("ObligationProposed", "obligation", IdSchemas.obligation, {
    contractId: IdSchemas.contract, contractVersionId: IdSchemas.contractVersion,
    kind: z.enum(OBLIGATION_KINDS), citationIds: z.array(IdSchemas.citation).min(1),
  }),
  ev("ObligationApproved", "obligation", IdSchemas.obligation, { contractId: IdSchemas.contract, approvedBy: IdSchemas.user }),
  ev("ObligationRejected", "obligation", IdSchemas.obligation, {
    contractId: IdSchemas.contract, rejectedBy: IdSchemas.user, reason: z.string().min(1).max(300),
  }),
  ev("ContractActivated", "contract", IdSchemas.contract, {
    contractVersionId: IdSchemas.contractVersion, approvedObligationIds: z.array(IdSchemas.obligation).min(1),
  }),
  ev("ScenarioCalculated", "scenario", IdSchemas.scenario, {
    forecastId: IdSchemas.forecast, runwayMonths: z.number().int().min(0).nullable(),
    inputsCommitment: HashCommitment, engineVersion: z.string().min(1).max(40),
  }),
  ev("TwinUpdated", "company", IdSchemas.company, {
    forecastId: IdSchemas.forecast, scenarioId: IdSchemas.scenario,
    cause: z.enum(["contract_activated", "settlement_reconciled", "scenario_changed"]),
    runwayMonths: z.number().int().min(0).nullable(),
  }),
  ev("MandateProposed", "mandate", IdSchemas.mandate, {
    contractId: IdSchemas.contract, delegateAgentId: IdSchemas.agent,
    obligationIds: z.array(IdSchemas.obligation).min(1), termsCommitment: HashCommitment,
  }),
  ev("MandateApproved", "mandate", IdSchemas.mandate, { approvedBy: IdSchemas.user }),
  ev("MandateActivated", "mandate", IdSchemas.mandate, {
    authorityStateCommitment: HashCommitment, registrationSignature: SolanaSignature,
  }),
  ev("MandateSuspended", "mandate", IdSchemas.mandate, { reason: z.string().min(1).max(300) }),
  ev("MandateRevoked", "mandate", IdSchemas.mandate, { revokedBy: IdSchemas.user, reason: z.string().min(1).max(300) }),
  ev("SpendRequested", "spendIntent", IdSchemas.spendIntent, {
    mandateId: IdSchemas.mandate, agentId: IdSchemas.agent, counterpartyId: IdSchemas.counterparty,
    taskId: IdSchemas.task, amount: MoneySchema,
  }),
  ev("SpendApproved", "spendIntent", IdSchemas.spendIntent, {
    policyDecisionId: IdSchemas.policyDecision, mandateId: IdSchemas.mandate, amount: MoneySchema, decidedBy,
  }),
  ev("SpendBlocked", "spendIntent", IdSchemas.spendIntent, {
    policyDecisionId: IdSchemas.policyDecision, mandateId: IdSchemas.mandate, amount: MoneySchema,
    reasonCodes, decidedBy,
  }),
  ev("SpendEscalated", "spendIntent", IdSchemas.spendIntent, {
    policyDecisionId: IdSchemas.policyDecision, mandateId: IdSchemas.mandate, amount: MoneySchema,
  }),
  ev("SpendSubmitted", "spendIntent", IdSchemas.spendIntent, {
    transactionId: IdSchemas.transaction, signature: SolanaSignature,
  }),
  ev("SettlementConfirmed", "settlement", IdSchemas.settlement, {
    transactionId: IdSchemas.transaction, spendIntentId: IdSchemas.spendIntent,
    signature: SolanaSignature, slot: z.number().int().min(0), amount: MoneySchema,
  }),
  ev("SettlementFailed", "settlement", IdSchemas.settlement, {
    transactionId: IdSchemas.transaction, reason: z.string().min(1).max(300),
  }),
  ev("LedgerEntryPosted", "ledgerEntry", IdSchemas.ledgerEntry, {
    settlementId: IdSchemas.settlement.nullable(),
    debitAccount: z.enum(LEDGER_ACCOUNTS), creditAccount: z.enum(LEDGER_ACCOUNTS), amount: MoneySchema,
    contractId: IdSchemas.contract.nullable(), obligationId: IdSchemas.obligation.nullable(),
    mandateId: IdSchemas.mandate.nullable(), agentId: IdSchemas.agent.nullable(), taskId: IdSchemas.task.nullable(),
  }),
  ev("SettlementReconciled", "settlement", IdSchemas.settlement, {
    ledgerEntryIds: z.array(IdSchemas.ledgerEntry).min(1),
  }),
  ev("TaskEconomicsRecorded", "taskEconomics", IdSchemas.taskEconomics, {
    taskId: IdSchemas.task, totalCost: MoneySchema,
  }),
  lifecycleTransitioned,
]);

const PREFIX_FOR = { contract: "ctr", obligation: "obl", mandate: "mnd", spendIntent: "spi", settlement: "stl" } as const;

/** Which actor types may emit which events. Anything not listed is system/human only. */
const HUMAN_ONLY: readonly DomainEventType[] = ["ObligationApproved", "ObligationRejected", "ContractActivated", "MandateApproved", "MandateRevoked"];
const AI_MAY_EMIT: readonly DomainEventType[] = ["TermsExtracted", "ExtractionFailed", "ObligationProposed", "MandateProposed"];

export const DomainEventSchema = eventUnion.superRefine((e, ctx) => {
  if (HUMAN_ONLY.includes(e.type) && e.actor.type !== "human") addIssue(ctx, ["actor"], `${e.type} must be authored by a human`);
  if (e.actor.type === "agent" && e.type !== "SpendRequested") addIssue(ctx, ["actor"], "agents may only emit SpendRequested");
  if (e.actor.type === "ai_model" && !AI_MAY_EMIT.includes(e.type)) addIssue(ctx, ["actor"], `AI models may not emit ${e.type}; AI interprets and proposes, humans approve`);

  switch (e.type) {
    case "ObligationApproved":
      if (e.actor.type === "human" && e.actor.id !== e.payload.approvedBy) addIssue(ctx, ["payload", "approvedBy"], "approvedBy must equal the acting human");
      break;
    case "ObligationRejected":
      if (e.actor.type === "human" && e.actor.id !== e.payload.rejectedBy) addIssue(ctx, ["payload", "rejectedBy"], "rejectedBy must equal the acting human");
      break;
    case "MandateApproved":
      if (e.actor.type === "human" && e.actor.id !== e.payload.approvedBy) addIssue(ctx, ["payload", "approvedBy"], "approvedBy must equal the acting human");
      break;
    case "MandateRevoked":
      if (e.actor.type === "human" && e.actor.id !== e.payload.revokedBy) addIssue(ctx, ["payload", "revokedBy"], "revokedBy must equal the acting human");
      break;
    case "SpendRequested":
      if (e.actor.type !== "agent" || e.actor.id !== e.payload.agentId) addIssue(ctx, ["actor"], "SpendRequested must be authored by the requesting agent");
      break;
    case "SpendApproved":
    case "SpendBlocked":
      if (e.payload.decidedBy === "human" && e.actor.type !== "human") addIssue(ctx, ["payload", "decidedBy"], "decidedBy=human requires a human actor");
      if (e.payload.decidedBy === "policy_engine" && e.actor.type !== "system") addIssue(ctx, ["payload", "decidedBy"], "decidedBy=policy_engine requires a system actor");
      break;
    case "SpendEscalated":
      if (e.actor.type !== "system") addIssue(ctx, ["actor"], "SpendEscalated is emitted by the policy engine");
      break;
    case "LifecycleTransitioned":
      if (!e.subject.id.startsWith(`${PREFIX_FOR[e.subject.type]}_`)) addIssue(ctx, ["subject", "id"], "subject id prefix does not match subject type");
      break;
    default:
      break;
  }
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
export type EventBody<T extends DomainEventType> =
  Omit<EventOf<T>, "eventId" | "schemaVersion" | "type" | "causationId"> & { readonly causationId?: EventId | null };

/** Build, validate and content-address an event. Throws FluxGraphError(SCHEMA_VIOLATION) on any rule breach. */
export function createEvent<T extends DomainEventType>(type: T, body: EventBody<T>): EventOf<T> {
  const draft = { ...body, causationId: body.causationId ?? null, type, schemaVersion: 1 };
  const eventId = deriveId("event", draft);
  const parsed = DomainEventSchema.safeParse({ ...draft, eventId });
  if (!parsed.success) {
    throw new FluxGraphError("SCHEMA_VIOLATION", `Invalid ${type} event`, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data as EventOf<T>;
}

export function parseEvent(input: unknown): Result<DomainEvent> {
  const parsed = DomainEventSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(new FluxGraphError("SCHEMA_VIOLATION", "Invalid domain event", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)));
}

export const isEventType = (s: string): s is DomainEventType => (EVENT_TYPES as readonly string[]).includes(s);
export { EVENT_TYPES };
export type { DomainEventType };
