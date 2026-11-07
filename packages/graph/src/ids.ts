import { z } from "zod";
import { canonicalize } from "./canonical";
import { FluxGraphError } from "./errors";
import { sha256Hex } from "./hash";

/**
 * Stable identifiers: `<prefix>_<24 hex chars>` where the hex is the first 96 bits of
 * SHA-256 over a domain-separated canonical encoding of the caller's seed parts.
 * Same seed parts => same id (idempotent, replayable). No clocks, no RNG inside this package:
 * callers that need uniqueness pass a nonce (e.g. an upload UUID) as one of the parts.
 */
export const ID_PREFIXES = {
  organization: "org",
  company: "cmp",
  user: "usr",
  agent: "agt",
  counterparty: "cpt",
  contract: "ctr",
  contractVersion: "ctv",
  citation: "cit",
  obligation: "obl",
  budget: "bud",
  mandate: "mnd",
  delegation: "dlg",
  spendIntent: "spi",
  policyDecision: "pol",
  transaction: "txn",
  settlement: "stl",
  ledgerEntry: "led",
  forecast: "fcs",
  scenario: "scn",
  task: "tsk",
  taskEconomics: "tec",
  auditEvent: "aud",
  event: "evt",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type Id<K extends IdKind> = string & z.BRAND<K>;

const idSchema = <K extends IdKind>(kind: K): z.ZodBranded<z.ZodString, K> =>
  z.string().regex(new RegExp(`^${ID_PREFIXES[kind]}_[0-9a-f]{24}$`), `Expected ${kind} id (${ID_PREFIXES[kind]}_<24 hex>)`).brand<K>();

export const IdSchemas = {
  organization: idSchema("organization"),
  company: idSchema("company"),
  user: idSchema("user"),
  agent: idSchema("agent"),
  counterparty: idSchema("counterparty"),
  contract: idSchema("contract"),
  contractVersion: idSchema("contractVersion"),
  citation: idSchema("citation"),
  obligation: idSchema("obligation"),
  budget: idSchema("budget"),
  mandate: idSchema("mandate"),
  delegation: idSchema("delegation"),
  spendIntent: idSchema("spendIntent"),
  policyDecision: idSchema("policyDecision"),
  transaction: idSchema("transaction"),
  settlement: idSchema("settlement"),
  ledgerEntry: idSchema("ledgerEntry"),
  forecast: idSchema("forecast"),
  scenario: idSchema("scenario"),
  task: idSchema("task"),
  taskEconomics: idSchema("taskEconomics"),
  auditEvent: idSchema("auditEvent"),
  event: idSchema("event"),
} as const;

export type OrganizationId = Id<"organization">;
export type CompanyId = Id<"company">;
export type UserId = Id<"user">;
export type AgentId = Id<"agent">;
export type CounterpartyId = Id<"counterparty">;
export type ContractId = Id<"contract">;
export type ContractVersionId = Id<"contractVersion">;
export type CitationId = Id<"citation">;
export type ObligationId = Id<"obligation">;
export type BudgetId = Id<"budget">;
export type MandateId = Id<"mandate">;
export type DelegationId = Id<"delegation">;
export type SpendIntentId = Id<"spendIntent">;
export type PolicyDecisionId = Id<"policyDecision">;
export type TransactionId = Id<"transaction">;
export type SettlementId = Id<"settlement">;
export type LedgerEntryId = Id<"ledgerEntry">;
export type ForecastId = Id<"forecast">;
export type ScenarioId = Id<"scenario">;
export type TaskId = Id<"task">;
export type TaskEconomicsId = Id<"taskEconomics">;
export type AuditEventId = Id<"auditEvent">;
export type EventId = Id<"event">;

/** Derive a stable id. Seed parts must be canonicalizable JSON (strings, numbers, booleans, null, arrays, plain objects). */
export function deriveId<K extends IdKind>(kind: K, ...seed: readonly unknown[]): Id<K> {
  if (seed.length === 0) throw new FluxGraphError("INVALID_ID", "deriveId requires at least one seed part");
  const prefix = ID_PREFIXES[kind];
  const digest = sha256Hex(`fluxgraph:id:v1:${prefix}:${canonicalize(seed)}`);
  return `${prefix}_${digest.slice(0, 24)}` as Id<K>;
}

export function parseId<K extends IdKind>(kind: K, value: unknown): Id<K> {
  const parsed = IdSchemas[kind].safeParse(value);
  if (!parsed.success) throw new FluxGraphError("INVALID_ID", `Invalid ${kind} id`, parsed.error.issues.map((i) => i.message));
  return parsed.data as Id<K>;
}

const PREFIX_TO_KIND = new Map<string, IdKind>(
  (Object.keys(ID_PREFIXES) as IdKind[]).map((k) => [ID_PREFIXES[k], k]),
);

/** Returns the kind encoded in an id's prefix, or null if the string is not a well-formed FluxGraph id. */
export function idKindOf(value: string): IdKind | null {
  const m = /^([a-z]{3})_[0-9a-f]{24}$/.exec(value);
  return m ? (PREFIX_TO_KIND.get(m[1]!) ?? null) : null;
}
