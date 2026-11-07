/**
 * FluxLedger: deterministic projections over the audit event stream.
 *
 *  - Pure fold: state = fold(events). `rebuildLedger(events)` reproduces it exactly.
 *  - Idempotent: applying an already-applied eventId is a no-op.
 *  - Quarantine: events that would corrupt the books (duplicate settlement, settlement without
 *    approval, non-human approver, …) stay in the audit log but do not change any projection; the
 *    finding is recorded as an anomaly with a machine-readable reason code.
 *  - No floating point: bigint minor units internally, decimal strings in every view.
 */
import type {
  AuditEvent, EventOfType, MandateCreatedPayload, ObligationApprovedPayload, SolanaCluster, SpendIntentSubmittedPayload,
} from './events.js';
import { isHumanActor } from './events.js';
import { DEFAULT_CURRENCY, MoneyError, parseMinor } from './money.js';
import { type PolicyEvaluation, evaluateSpendIntent } from './policy.js';
import { type ReasonCode, ReasonCodes, describeReason } from './reasons.js';
import type { EventReader } from './store.js';

export interface LedgerConfig { currency?: string }

// ───────────────────────────── Views (JSON-safe) ─────────────────────────────

export interface AgentSpendView { agentId: string; settledMinor: string; pendingMinor: string; settlementCount: number }
export interface VendorExpenseView { vendorId: string; settledMinor: string; settlementCount: number }
export interface ContractObligationView {
  obligationId: string; contractId: string; contractVersionId: string; vendorId: string; description: string; currency: string;
  totalMinor: string; settledMinor: string; pendingMinor: string; remainingMinor: string; periodCapMinor: string | null;
  status: 'approved' | 'fully_settled'; mandateIds: string[];
}
export interface SettlementView {
  settlementId: string; intentId: string; mandateId: string; obligationId: string; contractId: string; agentId: string;
  taskId: string; vendorId: string; currency: string; amountMinor: string; signature: string; cluster: SolanaCluster;
  slot: number; confirmedAt: string; eventId: string; sequence: number; ledgerEntryId: string;
}
export interface TaskEconomicsView {
  taskId: string; costMinor: string; revenueMinor: string; marginMinor: string;
  /** Margin in basis points of revenue (integer, truncated toward zero); null when revenue is zero. */
  marginBps: number | null; settlementCount: number;
}
export interface MandateAllowanceView {
  mandateId: string; obligationId: string; contractId: string; vendorId: string; currency: string;
  status: 'active' | 'revoked'; limitMinor: string; settledMinor: string; pendingMinor: string;
  /** limit − settled − pending, never below zero. */
  remainingMinor: string; perPaymentLimitMinor: string | null; periodCapMinor: string | null; periodDays: number | null;
  /** Remaining cap in the period window containing `asOf` (null if no periodic cap or no asOf given). */
  periodRemainingMinor: string | null; startsAt: string; expiresAt: string; revokedAt: string | null;
}
export type IntentStatus = 'submitted' | 'approved' | 'rejected' | 'settled' | 'failed';
export interface IntentView {
  intentId: string; mandateId: string; delegationId: string; agentId: string; taskId: string; vendorId: string;
  currency: string; amountMinor: string; status: IntentStatus; decisionId: string | null; reasonCodes: ReasonCode[];
  signature: string | null; cluster: SolanaCluster | null; settlementId: string | null;
}
export interface LedgerEntryView {
  entryId: string; sequence: number; postedAt: string; settlementId: string; contractId: string; obligationId: string;
  mandateId: string; agentId: string; taskId: string; vendorId: string; currency: string; amountMinor: string;
  signature: string; cluster: SolanaCluster; debitAccount: string; creditAccount: string;
}
export interface AnomalyView { eventId: string; sequence: number; code: ReasonCode; message: string; params: Record<string, string> }

export interface LedgerSnapshot {
  lastSequence: number; appliedEvents: number; currency: string;
  agentSpend: AgentSpendView[]; vendorExpense: VendorExpenseView[]; contractObligations: ContractObligationView[];
  settlements: SettlementView[]; taskEconomics: TaskEconomicsView[]; mandates: MandateAllowanceView[];
  intents: IntentView[]; ledgerEntries: LedgerEntryView[]; anomalies: AnomalyView[];
}

export type ApplyStatus = 'applied' | 'duplicate_skipped' | 'quarantined';
export interface ApplyResult { status: ApplyStatus; anomalies: AnomalyView[] }

export class LedgerError extends Error {
  constructor(public readonly code: 'SEQUENCE_REGRESSION', message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

// ───────────────────────────── Internal records ─────────────────────────────

interface ObligationRec {
  obligationId: string; contractId: string; contractVersionId: string; vendorId: string; description: string; currency: string;
  total: bigint; periodCap: bigint | undefined; settled: bigint; mandateIds: string[];
}
interface MandateRec {
  mandateId: string; obligationId: string; contractId: string; vendorId: string; currency: string; limit: bigint;
  perPayment: bigint | undefined; periodCap: bigint | undefined; periodDays: number | undefined;
  startsAt: string; startsAtMs: number; expiresAt: string; expiresAtMs: number;
  status: 'active' | 'revoked'; revokedAt: string | undefined; settled: bigint;
}
interface DelegationRec { delegationId: string; mandateId: string; agentId: string }
interface IntentRec {
  intentId: string; mandateId: string; delegationId: string; agentId: string; taskId: string; vendorId: string;
  currency: string; amount: bigint; status: IntentStatus; decisionId: string | undefined; reasonCodes: ReasonCode[];
  signature: string | undefined; cluster: SolanaCluster | undefined; settlementId: string | undefined;
}
interface SettlementRec extends Omit<SettlementView, 'amountMinor'> { amount: bigint; confirmedAtMs: number }
interface TaskRec { taskId: string; cost: bigint; revenue: bigint; settlementCount: number }

class PayloadError extends Error {}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortBy = <T>(items: T[], key: (t: T) => string): T[] => items.sort((a, b) => cmp(key(a), key(b)));

function parseTime(value: unknown, field: string): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) throw new PayloadError(`${field} must be an ISO-8601 timestamp`);
  return ms;
}

// ───────────────────────────── Projection ─────────────────────────────

export class LedgerProjection {
  readonly currency: string;
  private lastSeq = 0;
  private readonly applied = new Set<string>();
  private readonly obligations = new Map<string, ObligationRec>();
  private readonly mandates = new Map<string, MandateRec>();
  private readonly delegations = new Map<string, DelegationRec>();
  private readonly intents = new Map<string, IntentRec>();
  private readonly settlementsById = new Map<string, SettlementRec>();
  private readonly settlementBySignature = new Map<string, string>();
  private readonly entries: LedgerEntryView[] = [];
  private readonly tasks = new Map<string, TaskRec>();
  private readonly revenueIds = new Set<string>();
  private readonly anomalyList: AnomalyView[] = [];

  constructor(config: LedgerConfig = {}) {
    this.currency = config.currency ?? DEFAULT_CURRENCY;
  }

  get lastSequence(): number { return this.lastSeq; }
  get appliedEventCount(): number { return this.applied.size; }
  hasApplied(eventId: string): boolean { return this.applied.has(eventId); }

  /** Idempotent. Throws only for a non-monotonic sequence on a not-yet-seen event (a caller bug). */
  apply(event: AuditEvent): ApplyResult {
    if (this.applied.has(event.eventId)) return { status: 'duplicate_skipped', anomalies: [] };
    if (event.sequence <= this.lastSeq) {
      throw new LedgerError('SEQUENCE_REGRESSION', `Event ${event.eventId} has sequence ${event.sequence} ≤ last applied ${this.lastSeq}`);
    }
    const before = this.anomalyList.length;
    try {
      this.dispatch(event);
    } catch (err) {
      if (err instanceof PayloadError || err instanceof MoneyError) this.flag(event, ReasonCodes.INVALID_PAYLOAD, { detail: err.message });
      else throw err;
    }
    this.applied.add(event.eventId);
    this.lastSeq = event.sequence;
    const anomalies = this.anomalyList.slice(before);
    return { status: anomalies.length > 0 ? 'quarantined' : 'applied', anomalies };
  }

  private flag(event: AuditEvent, code: ReasonCode, params: Record<string, string>): void {
    this.anomalyList.push({ eventId: event.eventId, sequence: event.sequence, code, params, message: describeReason(code, params) });
  }

  private dispatch(event: AuditEvent): void {
    switch (event.type) {
      case 'ContractRegistered':
      case 'ContractVersionRecorded':
      case 'EvidenceClauseLinked':
      case 'TwinScenarioRecorded':
        return; // audit-only facts: used by FluxProof, no ledger effect
      case 'ObligationApproved': return this.onObligation(event);
      case 'MandateCreated': return this.onMandate(event);
      case 'MandateRevoked': return this.onRevoke(event);
      case 'DelegationGranted': return this.onDelegation(event);
      case 'SpendIntentSubmitted': return this.onIntent(event);
      case 'PolicyDecisionRecorded': return this.onDecision(event);
      case 'TransactionSubmitted': return this.onTransaction(event);
      case 'SettlementConfirmed': return this.onSettlement(event);
      case 'SettlementFailed': return this.onFailure(event);
      case 'TaskRevenueRecorded': return this.onRevenue(event);
      default: {
        const unreachable: never = event;
        throw new PayloadError(`Unknown event type ${String((unreachable as { type?: string }).type)}`);
      }
    }
  }

  private checkCurrency(event: AuditEvent, currency: string): boolean {
    if (currency === this.currency) return true;
    this.flag(event, ReasonCodes.UNSUPPORTED_CURRENCY, { currency, expected: this.currency });
    return false;
  }
  private checkHuman(event: AuditEvent, actor: string): boolean {
    if (isHumanActor(actor)) return true;
    this.flag(event, ReasonCodes.NON_HUMAN_APPROVER, { approvedBy: actor });
    return false;
  }
  private unknown(event: AuditEvent, entity: string, id: string, extra: Record<string, string> = {}): void {
    this.flag(event, ReasonCodes.UNKNOWN_REFERENCE, { entity, id, ...extra });
  }

  private onObligation(event: EventOfType<'ObligationApproved'>): void {
    const p: ObligationApprovedPayload = event.payload;
    if (!this.checkHuman(event, p.approvedBy) || !this.checkCurrency(event, p.currency)) return;
    if (this.obligations.has(p.obligationId)) return this.flag(event, ReasonCodes.DUPLICATE_ENTITY, { entity: 'obligation', id: p.obligationId });
    const total = parseMinor(p.totalMinor, 'totalMinor');
    this.obligations.set(p.obligationId, {
      obligationId: p.obligationId, contractId: p.contractId, contractVersionId: p.contractVersionId, vendorId: p.vendorId,
      description: p.description, currency: p.currency, total,
      periodCap: p.periodCapMinor === undefined ? undefined : parseMinor(p.periodCapMinor, 'periodCapMinor'),
      settled: 0n, mandateIds: [],
    });
  }

  private onMandate(event: EventOfType<'MandateCreated'>): void {
    const p: MandateCreatedPayload = event.payload;
    if (!this.checkHuman(event, p.approvedBy) || !this.checkCurrency(event, p.currency)) return;
    if (this.mandates.has(p.mandateId)) return this.flag(event, ReasonCodes.DUPLICATE_ENTITY, { entity: 'mandate', id: p.mandateId });
    const ob = this.obligations.get(p.obligationId);
    if (!ob) return this.unknown(event, 'obligation', p.obligationId, { mandateId: p.mandateId });
    const limit = parseMinor(p.limitMinor, 'limitMinor');
    if (ob.vendorId !== p.vendorId) {
      return this.flag(event, ReasonCodes.MANDATE_OBLIGATION_VENDOR_MISMATCH, { mandateVendorId: p.vendorId, obligationVendorId: ob.vendorId, mandateId: p.mandateId });
    }
    if (ob.contractId !== p.contractId) throw new PayloadError('mandate contractId differs from its obligation');
    if (limit > ob.total) {
      return this.flag(event, ReasonCodes.MANDATE_EXCEEDS_OBLIGATION, { limitMinor: limit.toString(), obligationMinor: ob.total.toString(), currency: ob.currency, mandateId: p.mandateId });
    }
    const perPayment = p.perPaymentLimitMinor === undefined ? undefined : parseMinor(p.perPaymentLimitMinor, 'perPaymentLimitMinor');
    const periodCap = p.periodCapMinor === undefined ? undefined : parseMinor(p.periodCapMinor, 'periodCapMinor');
    if (periodCap !== undefined && !(Number.isInteger(p.periodDays) && (p.periodDays as number) >= 1)) {
      throw new PayloadError('periodDays (integer ≥ 1) is required with periodCapMinor');
    }
    const startsAtMs = parseTime(p.startsAt, 'startsAt');
    const expiresAtMs = parseTime(p.expiresAt, 'expiresAt');
    if (expiresAtMs <= startsAtMs) throw new PayloadError('expiresAt must be after startsAt');
    this.mandates.set(p.mandateId, {
      mandateId: p.mandateId, obligationId: p.obligationId, contractId: p.contractId, vendorId: p.vendorId, currency: p.currency,
      limit, perPayment, periodCap, periodDays: periodCap === undefined ? undefined : p.periodDays,
      startsAt: p.startsAt, startsAtMs, expiresAt: p.expiresAt, expiresAtMs, status: 'active', revokedAt: undefined, settled: 0n,
    });
    ob.mandateIds.push(p.mandateId);
  }

  private onRevoke(event: EventOfType<'MandateRevoked'>): void {
    const m = this.mandates.get(event.payload.mandateId);
    if (!m) return this.unknown(event, 'mandate', event.payload.mandateId);
    if (m.status === 'revoked') return; // idempotent by nature; first revocation time wins
    m.status = 'revoked';
    m.revokedAt = event.occurredAt;
  }

  private onDelegation(event: EventOfType<'DelegationGranted'>): void {
    const p = event.payload;
    if (!this.checkHuman(event, p.grantedBy)) return;
    if (!this.mandates.has(p.mandateId)) return this.unknown(event, 'mandate', p.mandateId, { delegationId: p.delegationId });
    if (this.delegations.has(p.delegationId)) return this.flag(event, ReasonCodes.DUPLICATE_ENTITY, { entity: 'delegation', id: p.delegationId });
    this.delegations.set(p.delegationId, { delegationId: p.delegationId, mandateId: p.mandateId, agentId: p.agentId });
  }

  private onIntent(event: EventOfType<'SpendIntentSubmitted'>): void {
    const p: SpendIntentSubmittedPayload = event.payload;
    if (!this.checkCurrency(event, p.currency)) return;
    if (this.intents.has(p.intentId)) return this.flag(event, ReasonCodes.DUPLICATE_ENTITY, { entity: 'intent', id: p.intentId, intentId: p.intentId });
    this.intents.set(p.intentId, {
      intentId: p.intentId, mandateId: p.mandateId, delegationId: p.delegationId, agentId: p.agentId, taskId: p.taskId,
      vendorId: p.vendorId, currency: p.currency, amount: parseMinor(p.amountMinor, 'amountMinor'), status: 'submitted',
      decisionId: undefined, reasonCodes: [], signature: undefined, cluster: undefined, settlementId: undefined,
    });
  }

  private onDecision(event: EventOfType<'PolicyDecisionRecorded'>): void {
    const p = event.payload;
    const intent = this.intents.get(p.intentId);
    if (!intent) return this.unknown(event, 'intent', p.intentId, { intentId: p.intentId });
    if (intent.decisionId !== undefined) return this.flag(event, ReasonCodes.DECISION_CONFLICT, { intentId: p.intentId });
    intent.decisionId = p.decisionId;
    intent.reasonCodes = [...p.reasonCodes];
    intent.status = p.decision === 'approved' ? 'approved' : 'rejected';
  }

  private onTransaction(event: EventOfType<'TransactionSubmitted'>): void {
    const p = event.payload;
    const intent = this.intents.get(p.intentId);
    if (!intent) return this.unknown(event, 'intent', p.intentId, { intentId: p.intentId });
    if (intent.status !== 'approved') {
      return this.flag(event, ReasonCodes.TRANSACTION_FOR_UNAPPROVED_INTENT, { intentId: p.intentId, intentStatus: intent.status });
    }
    intent.signature = p.signature;
    intent.cluster = p.cluster;
  }

  private onSettlement(event: EventOfType<'SettlementConfirmed'>): void {
    const p = event.payload;
    const amount = parseMinor(p.amountMinor, 'amountMinor');
    const confirmedAtMs = parseTime(p.confirmedAt, 'confirmedAt');
    const base = { settlementId: p.settlementId, intentId: p.intentId };
    const sigKey = `${p.cluster}:${p.signature}`;

    const dupId = this.settlementsById.get(p.settlementId);
    if (dupId) return this.flag(event, ReasonCodes.DUPLICATE_SETTLEMENT_ID, { ...base, originalSettlementId: dupId.settlementId });
    const dupSig = this.settlementBySignature.get(sigKey);
    if (dupSig) {
      return this.flag(event, ReasonCodes.DUPLICATE_SETTLEMENT_SIGNATURE, { ...base, signature: p.signature, cluster: p.cluster, originalSettlementId: dupSig });
    }
    const intent = this.intents.get(p.intentId);
    if (!intent) return this.unknown(event, 'intent', p.intentId, base);
    if (intent.settlementId !== undefined) {
      return this.flag(event, ReasonCodes.DUPLICATE_SETTLEMENT_INTENT, { ...base, originalSettlementId: intent.settlementId });
    }
    if (intent.status !== 'approved') {
      return this.flag(event, ReasonCodes.SETTLEMENT_WITHOUT_APPROVED_DECISION, { ...base, intentStatus: intent.status });
    }
    if (!this.checkCurrency(event, p.currency)) return;
    if (amount !== intent.amount) {
      return this.flag(event, ReasonCodes.SETTLEMENT_AMOUNT_MISMATCH, { ...base, settledMinor: amount.toString(), intentMinor: intent.amount.toString(), currency: intent.currency });
    }
    if (p.vendorId !== intent.vendorId) {
      return this.flag(event, ReasonCodes.SETTLEMENT_VENDOR_MISMATCH, { ...base, settledVendorId: p.vendorId, intentVendorId: intent.vendorId });
    }
    if (intent.signature !== undefined && intent.signature !== p.signature) {
      return this.flag(event, ReasonCodes.SETTLEMENT_SIGNATURE_MISMATCH, base);
    }
    const mandate = this.mandates.get(intent.mandateId);
    if (!mandate) return this.unknown(event, 'mandate', intent.mandateId, base);
    const obligation = this.obligations.get(mandate.obligationId);
    if (!obligation) return this.unknown(event, 'obligation', mandate.obligationId, base);

    // ── Book it ──
    const entryId = `le_${p.settlementId}`;
    const rec: SettlementRec = {
      settlementId: p.settlementId, intentId: p.intentId, mandateId: mandate.mandateId, obligationId: obligation.obligationId,
      contractId: mandate.contractId, agentId: intent.agentId, taskId: intent.taskId, vendorId: intent.vendorId,
      currency: intent.currency, amount, signature: p.signature, cluster: p.cluster, slot: p.slot, confirmedAt: p.confirmedAt,
      confirmedAtMs, eventId: event.eventId, sequence: event.sequence, ledgerEntryId: entryId,
    };
    this.settlementsById.set(p.settlementId, rec);
    this.settlementBySignature.set(sigKey, p.settlementId);
    intent.status = 'settled';
    intent.settlementId = p.settlementId;
    intent.signature = p.signature;
    intent.cluster = p.cluster;
    mandate.settled += amount;
    obligation.settled += amount;
    const task = this.task(intent.taskId);
    task.cost += amount;
    task.settlementCount += 1;
    this.entries.push({
      entryId, sequence: event.sequence, postedAt: p.confirmedAt, settlementId: p.settlementId, contractId: mandate.contractId,
      obligationId: obligation.obligationId, mandateId: mandate.mandateId, agentId: intent.agentId, taskId: intent.taskId,
      vendorId: intent.vendorId, currency: intent.currency, amountMinor: amount.toString(), signature: p.signature,
      cluster: p.cluster, debitAccount: `expense:vendor:${intent.vendorId}`, creditAccount: `treasury:${intent.currency}`,
    });
  }

  private onFailure(event: EventOfType<'SettlementFailed'>): void {
    const intent = this.intents.get(event.payload.intentId);
    if (!intent) return this.unknown(event, 'intent', event.payload.intentId, { intentId: event.payload.intentId });
    if (intent.status !== 'approved') {
      return this.flag(event, ReasonCodes.TRANSACTION_FOR_UNAPPROVED_INTENT, { intentId: intent.intentId, intentStatus: intent.status });
    }
    intent.status = 'failed'; // releases the pending reservation
  }

  private onRevenue(event: EventOfType<'TaskRevenueRecorded'>): void {
    const p = event.payload;
    if (!this.checkCurrency(event, p.currency)) return;
    if (this.revenueIds.has(p.revenueId)) return this.flag(event, ReasonCodes.DUPLICATE_ENTITY, { entity: 'revenue', id: p.revenueId });
    const amount = parseMinor(p.amountMinor, 'amountMinor');
    if (amount === 0n) throw new PayloadError('revenue amount must be greater than zero');
    this.revenueIds.add(p.revenueId);
    this.task(p.taskId).revenue += amount;
  }

  private task(taskId: string): TaskRec {
    let t = this.tasks.get(taskId);
    if (!t) { t = { taskId, cost: 0n, revenue: 0n, settlementCount: 0 }; this.tasks.set(taskId, t); }
    return t;
  }

  // ───────────────────────────── Queries ─────────────────────────────

  private pendingForMandate(mandateId: string): bigint {
    let sum = 0n;
    for (const i of this.intents.values()) if (i.status === 'approved' && i.mandateId === mandateId) sum += i.amount;
    return sum;
  }

  private periodWindow(m: MandateRec, nowMs: number): { start: number; end: number } | undefined {
    if (m.periodCap === undefined || m.periodDays === undefined) return undefined;
    const len = m.periodDays * 86_400_000;
    const idx = Math.floor((nowMs - m.startsAtMs) / len);
    return { start: m.startsAtMs + idx * len, end: m.startsAtMs + (idx + 1) * len };
  }

  private settledInWindow(m: MandateRec, nowMs: number): bigint {
    const w = this.periodWindow(m, nowMs);
    if (!w) return 0n;
    let sum = 0n;
    for (const s of this.settlementsById.values()) {
      if (s.mandateId === m.mandateId && s.confirmedAtMs >= w.start && s.confirmedAtMs < w.end) sum += s.amount;
    }
    return sum;
  }

  mandateAllowance(mandateId: string, asOf?: string): MandateAllowanceView | undefined {
    const m = this.mandates.get(mandateId);
    if (!m) return undefined;
    const pending = this.pendingForMandate(mandateId);
    const remaining = m.limit - m.settled - pending;
    let periodRemaining: string | null = null;
    if (asOf !== undefined && m.periodCap !== undefined) {
      const left = m.periodCap - this.settledInWindow(m, parseTime(asOf, 'asOf')) - pending;
      periodRemaining = (left > 0n ? left : 0n).toString();
    }
    return {
      mandateId, obligationId: m.obligationId, contractId: m.contractId, vendorId: m.vendorId, currency: m.currency,
      status: m.status, limitMinor: m.limit.toString(), settledMinor: m.settled.toString(), pendingMinor: pending.toString(),
      remainingMinor: (remaining > 0n ? remaining : 0n).toString(), perPaymentLimitMinor: m.perPayment?.toString() ?? null,
      periodCapMinor: m.periodCap?.toString() ?? null, periodDays: m.periodDays ?? null, periodRemainingMinor: periodRemaining,
      startsAt: m.startsAt, expiresAt: m.expiresAt, revokedAt: m.revokedAt ?? null,
    };
  }

  mandateAllowances(asOf?: string): MandateAllowanceView[] {
    return sortBy([...this.mandates.keys()].map((id) => this.mandateAllowance(id, asOf) as MandateAllowanceView), (v) => v.mandateId);
  }

  agentSpend(): AgentSpendView[] {
    const map = new Map<string, { settled: bigint; pending: bigint; count: number }>();
    const get = (id: string) => { let r = map.get(id); if (!r) { r = { settled: 0n, pending: 0n, count: 0 }; map.set(id, r); } return r; };
    for (const s of this.settlementsById.values()) { const r = get(s.agentId); r.settled += s.amount; r.count += 1; }
    for (const i of this.intents.values()) if (i.status === 'approved') get(i.agentId).pending += i.amount;
    return sortBy([...map].map(([agentId, r]) => ({ agentId, settledMinor: r.settled.toString(), pendingMinor: r.pending.toString(), settlementCount: r.count })), (v) => v.agentId);
  }

  vendorExpense(): VendorExpenseView[] {
    const map = new Map<string, { settled: bigint; count: number }>();
    for (const s of this.settlementsById.values()) {
      const r = map.get(s.vendorId) ?? { settled: 0n, count: 0 };
      r.settled += s.amount; r.count += 1; map.set(s.vendorId, r);
    }
    return sortBy([...map].map(([vendorId, r]) => ({ vendorId, settledMinor: r.settled.toString(), settlementCount: r.count })), (v) => v.vendorId);
  }

  contractObligations(): ContractObligationView[] {
    return sortBy([...this.obligations.values()].map((o) => {
      let pending = 0n;
      for (const i of this.intents.values()) {
        if (i.status === 'approved' && this.mandates.get(i.mandateId)?.obligationId === o.obligationId) pending += i.amount;
      }
      const remaining = o.total - o.settled - pending;
      return {
        obligationId: o.obligationId, contractId: o.contractId, contractVersionId: o.contractVersionId, vendorId: o.vendorId,
        description: o.description, currency: o.currency, totalMinor: o.total.toString(), settledMinor: o.settled.toString(),
        pendingMinor: pending.toString(), remainingMinor: (remaining > 0n ? remaining : 0n).toString(),
        periodCapMinor: o.periodCap?.toString() ?? null, status: o.settled >= o.total ? 'fully_settled' as const : 'approved' as const,
        mandateIds: [...o.mandateIds],
      };
    }), (v) => v.obligationId);
  }

  settlements(): SettlementView[] {
    return sortBy([...this.settlementsById.values()].map(({ amount, confirmedAtMs: _ms, ...rest }) => ({ ...rest, amountMinor: amount.toString() })), (v) => v.settlementId);
  }
  settlementForIntent(intentId: string): SettlementView | undefined {
    const id = this.intents.get(intentId)?.settlementId;
    return id === undefined ? undefined : this.settlements().find((s) => s.settlementId === id);
  }

  taskEconomics(): TaskEconomicsView[] {
    return sortBy([...this.tasks.values()].map((t) => {
      const margin = t.revenue - t.cost;
      return {
        taskId: t.taskId, costMinor: t.cost.toString(), revenueMinor: t.revenue.toString(), marginMinor: margin.toString(),
        marginBps: t.revenue === 0n ? null : Number((margin * 10_000n) / t.revenue), settlementCount: t.settlementCount,
      };
    }), (v) => v.taskId);
  }

  intentViews(): IntentView[] {
    return sortBy([...this.intents.values()].map((i) => ({
      intentId: i.intentId, mandateId: i.mandateId, delegationId: i.delegationId, agentId: i.agentId, taskId: i.taskId, vendorId: i.vendorId,
      currency: i.currency, amountMinor: i.amount.toString(), status: i.status, decisionId: i.decisionId ?? null,
      reasonCodes: [...i.reasonCodes], signature: i.signature ?? null, cluster: i.cluster ?? null, settlementId: i.settlementId ?? null,
    })), (v) => v.intentId);
  }

  ledgerEntries(): LedgerEntryView[] { return this.entries.map((e) => ({ ...e })); }
  anomalies(): AnomalyView[] { return this.anomalyList.map((a) => ({ ...a, params: { ...a.params } })); }

  /** Reference evaluation of a prospective spend against current state (see policy.ts: not the enforcement point). */
  evaluateIntent(intent: Pick<SpendIntentSubmittedPayload, 'mandateId' | 'delegationId' | 'agentId' | 'vendorId' | 'currency' | 'amountMinor'>, nowIso: string): PolicyEvaluation {
    const nowMs = parseTime(nowIso, 'now');
    const m = this.mandates.get(intent.mandateId);
    const d = this.delegations.get(intent.delegationId);
    return evaluateSpendIntent({
      mandate: m && {
        mandateId: m.mandateId, vendorId: m.vendorId, currency: m.currency, limit: m.limit, perPaymentLimit: m.perPayment,
        periodCap: m.periodCap, periodDays: m.periodDays, startsAt: m.startsAt, startsAtMs: m.startsAtMs, expiresAt: m.expiresAt,
        expiresAtMs: m.expiresAtMs, revoked: m.status === 'revoked', settledTotal: m.settled,
        pendingTotal: this.pendingForMandate(m.mandateId), settledInPeriod: this.settledInWindow(m, nowMs),
      },
      delegation: d,
      intent: { mandateId: intent.mandateId, delegationId: intent.delegationId, agentId: intent.agentId, vendorId: intent.vendorId, currency: intent.currency, amount: parseMinor(intent.amountMinor, 'amountMinor') },
      nowMs,
    });
  }

  snapshot(asOf?: string): LedgerSnapshot {
    return {
      lastSequence: this.lastSeq, appliedEvents: this.applied.size, currency: this.currency, agentSpend: this.agentSpend(),
      vendorExpense: this.vendorExpense(), contractObligations: this.contractObligations(), settlements: this.settlements(),
      taskEconomics: this.taskEconomics(), mandates: this.mandateAllowances(asOf), intents: this.intentViews(),
      ledgerEntries: this.ledgerEntries(), anomalies: this.anomalies(),
    };
  }
}

/** Rebuilds all projections from scratch. Same events ⇒ identical snapshot. */
export function rebuildLedger(events: Iterable<AuditEvent>, config?: LedgerConfig): LedgerProjection {
  const projection = new LedgerProjection(config);
  for (const e of events) projection.apply(e);
  return projection;
}

export interface CatchUpResult { applied: number; duplicatesSkipped: number; quarantined: number; lastSequence: number }

/** Pulls from an EventReader starting at the projection's cursor. Safe to call repeatedly or concurrently-after-await. */
export class LedgerConsumer {
  constructor(
    private readonly reader: EventReader,
    readonly projection: LedgerProjection = new LedgerProjection(),
    private readonly batchSize = 200,
  ) {}

  async catchUp(): Promise<CatchUpResult> {
    const result: CatchUpResult = { applied: 0, duplicatesSkipped: 0, quarantined: 0, lastSequence: this.projection.lastSequence };
    for (;;) {
      const batch = await this.reader.readFrom(this.projection.lastSequence, this.batchSize);
      if (batch.length === 0) break;
      for (const event of batch) {
        const r = this.projection.apply(event);
        if (r.status === 'duplicate_skipped') result.duplicatesSkipped++;
        else { result.applied++; if (r.status === 'quarantined') result.quarantined++; }
      }
    }
    result.lastSequence = this.projection.lastSequence;
    return result;
  }
}
