/**
 * FluxProof: builds an explainable, privacy-aware evidence trace for one spend intent:
 *
 *  Contract → Contract version → Evidence clause → Approved obligation → Twin scenario → Mandate →
 *  Delegation → Spend intent → Policy decision → Solana transaction → Settlement → Ledger entry
 *
 * Pure function of the event list. Events the ledger quarantined (duplicates, non-human approvals…)
 * are never used as evidence; they are reported separately under `anomalies`.
 */
import type { JsonValue } from './canonical.js';
import type { AuditEvent, AuditEventType, EventOfType } from './events.js';
import { ExplorerUrlError, type ExplorerOptions, buildExplorerUrl } from './explorer.js';
import { type AnomalyView, rebuildLedger } from './ledger.js';
import { formatAmount } from './money.js';
import { REDACTED, redactValue, redactedKeysFor } from './redaction.js';
import { type ReasonCode, type ReasonParams, explainDecision, reasonTitle } from './reasons.js';
import { type ChainVerification, verifyEventChain } from './store.js';

export type ProofStepKind =
  | 'contract' | 'contract_version' | 'evidence_clause' | 'approved_obligation' | 'twin_scenario' | 'mandate'
  | 'delegation' | 'spend_intent' | 'policy_decision' | 'solana_transaction' | 'settlement' | 'ledger_entry';

export const PROOF_STEP_ORDER: readonly ProofStepKind[] = [
  'contract', 'contract_version', 'evidence_clause', 'approved_obligation', 'twin_scenario', 'mandate',
  'delegation', 'spend_intent', 'policy_decision', 'solana_transaction', 'settlement', 'ledger_entry',
];

const STEP_TITLES: Readonly<Record<ProofStepKind, string>> = {
  contract: 'Contract', contract_version: 'Contract version', evidence_clause: 'Evidence clause',
  approved_obligation: 'Approved obligation', twin_scenario: 'Twin scenario', mandate: 'Mandate', delegation: 'Delegation',
  spend_intent: 'Spend intent', policy_decision: 'Policy decision', solana_transaction: 'Solana transaction',
  settlement: 'Settlement', ledger_entry: 'Ledger entry',
};

export type ProofStepStatus = 'present' | 'missing' | 'not_applicable';
export type TracePrivacy = 'internal' | 'auditor' | 'public';
export type TraceOutcome = 'settled' | 'rejected' | 'approved_pending_settlement' | 'failed' | 'awaiting_decision';

export interface ProofEntry {
  refId: string;
  eventId: string | null;
  sequence: number | null;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  explorerUrl?: string;
}
export interface ProofStep {
  kind: ProofStepKind; title: string; status: ProofStepStatus; entries: ProofEntry[]; note?: string;
  /** Present on policy_decision. */
  reasonCodes?: ReasonCode[];
  /** Human-readable, one sentence per reason code. */
  reasons?: string[];
}
export interface ProofTrace {
  traceId: string;
  intentId: string;
  outcome: TraceOutcome;
  headline: string;
  privacy: TracePrivacy;
  steps: ProofStep[];
  /** True when every applicable step is present. */
  complete: boolean;
  gaps: string[];
  anomalies: AnomalyView[];
  integrity: ChainVerification;
}

export interface TraceQuery { intentId?: string; settlementId?: string }
export interface TraceOptions { privacy?: TracePrivacy; explorer?: ExplorerOptions }

export class ProofError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'BAD_QUERY', message: string) {
    super(message);
    this.name = 'ProofError';
  }
}

type Details = ProofEntry['details'];
const compact = (o: Record<string, string | number | boolean | null | undefined>): Details => {
  const out: Details = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};

export function buildProofTrace(events: readonly AuditEvent[], query: TraceQuery, options: TraceOptions = {}): ProofTrace {
  const privacy = options.privacy ?? 'auditor';
  const projection = rebuildLedger(events);
  const integrity = verifyEventChain(events);
  const quarantined = new Set(projection.anomalies().map((a) => a.eventId));
  const usable = events.filter((e) => !quarantined.has(e.eventId));
  const ofType = <T extends AuditEventType>(type: T): EventOfType<T>[] => usable.filter((e): e is EventOfType<T> => e.type === type);

  // ── Resolve subject ──
  let intentId = query.intentId;
  if (intentId === undefined && query.settlementId !== undefined) {
    intentId = events.find((e): e is EventOfType<'SettlementConfirmed'> => e.type === 'SettlementConfirmed' && e.payload.settlementId === query.settlementId)?.payload.intentId;
  }
  if (query.intentId === undefined && query.settlementId === undefined) throw new ProofError('BAD_QUERY', 'Provide intentId or settlementId');
  const intentEvent = intentId === undefined ? undefined : ofType('SpendIntentSubmitted').find((e) => e.payload.intentId === intentId);
  if (!intentEvent || intentId === undefined) throw new ProofError('NOT_FOUND', `No spend intent found for ${JSON.stringify(query)}`);
  const intent = projection.intentViews().find((i) => i.intentId === intentId);
  if (!intent) throw new ProofError('NOT_FOUND', `Intent ${intentId} is not in the ledger`);

  // ── Walk the chain backwards from the intent ──
  const mandateEv = ofType('MandateCreated').find((e) => e.payload.mandateId === intent.mandateId);
  const revokeEv = ofType('MandateRevoked').find((e) => e.payload.mandateId === intent.mandateId);
  const obligationEv = mandateEv && ofType('ObligationApproved').find((e) => e.payload.obligationId === mandateEv.payload.obligationId);
  const contractEv = obligationEv && ofType('ContractRegistered').find((e) => e.payload.contractId === obligationEv.payload.contractId);
  const versionEv = obligationEv && ofType('ContractVersionRecorded').find((e) => e.payload.contractVersionId === obligationEv.payload.contractVersionId);
  const clauseEvs = obligationEv ? obligationEv.payload.clauseIds.map((id) => ({ id, ev: ofType('EvidenceClauseLinked').find((e) => e.payload.clauseId === id) })) : [];
  const twinEv = obligationEv && (
    (mandateEv?.payload.twinScenarioId !== undefined && ofType('TwinScenarioRecorded').find((e) => e.payload.scenarioId === mandateEv.payload.twinScenarioId)) ||
    ofType('TwinScenarioRecorded').find((e) => e.payload.obligationIds.includes(obligationEv.payload.obligationId))
  ) || undefined;
  const delegationEv = ofType('DelegationGranted').find((e) => e.payload.delegationId === intent.delegationId);
  const decisionEv = ofType('PolicyDecisionRecorded').find((e) => e.payload.intentId === intentId);
  const txEv = ofType('TransactionSubmitted').find((e) => e.payload.intentId === intentId);
  const failEv = ofType('SettlementFailed').find((e) => e.payload.intentId === intentId);
  const settlement = projection.settlementForIntent(intentId);
  const ledgerEntry = settlement && projection.ledgerEntries().find((l) => l.settlementId === settlement.settlementId);

  const vendorLabel = privacy === 'public' ? intent.vendorId : (contractEv?.payload.vendorName ?? intent.vendorId);
  const amountText = formatAmount(BigInt(intent.amountMinor), intent.currency);
  const redactKeys = privacy === 'internal' ? new Set<string>() : redactedKeysFor(privacy);
  const clean = (d: Details): Details => redactValue(d as unknown as JsonValue, redactKeys) as unknown as Details;
  const entry = (ev: AuditEvent | undefined, refId: string, summary: string, details: Details, explorerUrl?: string): ProofEntry => {
    const e: ProofEntry = { refId, eventId: ev?.eventId ?? null, sequence: ev?.sequence ?? null, summary, details: clean(details) };
    if (explorerUrl !== undefined) e.explorerUrl = explorerUrl;
    return e;
  };
  const safeUrl = (target: 'tx' | 'address', cluster: 'localnet' | 'devnet', id: string): string | undefined => {
    try { return buildExplorerUrl(cluster, target, id, options.explorer); } catch (err) { if (err instanceof ExplorerUrlError) return undefined; throw err; }
  };

  const rejected = intent.status === 'rejected';
  const steps: ProofStep[] = [];
  const gaps: string[] = [];
  const push = (kind: ProofStepKind, status: ProofStepStatus, entries: ProofEntry[], note?: string, extra?: Partial<ProofStep>): void => {
    const s: ProofStep = { kind, title: STEP_TITLES[kind], status, entries, ...extra };
    if (note !== undefined) s.note = note;
    steps.push(s);
    if (status === 'missing') gaps.push(`${STEP_TITLES[kind]}: ${note ?? 'not found in the audit log'}`);
  };
  const missingUpstream = 'cannot be resolved because an earlier link in the chain is missing';

  // 1 contract
  push('contract', contractEv ? 'present' : 'missing', contractEv ? [entry(contractEv, contractEv.payload.contractId,
    `Contract ${privacy === 'public' ? contractEv.payload.contractId : `"${contractEv.payload.title}" with ${contractEv.payload.vendorName}`} (document kept private; only a salted commitment is recorded).`,
    compact({ contractId: contractEv.payload.contractId, vendorId: contractEv.payload.vendorId, vendorName: contractEv.payload.vendorName, title: contractEv.payload.title, documentCommitment: contractEv.payload.documentCommitment, synthetic: contractEv.payload.synthetic }))] : [],
    contractEv ? undefined : (obligationEv ? 'contract record not found' : missingUpstream));

  // 2 version
  push('contract_version', versionEv ? 'present' : 'missing', versionEv ? [entry(versionEv, versionEv.payload.contractVersionId,
    `Version ${versionEv.payload.versionNumber} signed ${versionEv.payload.signedAt}.`,
    compact({ contractVersionId: versionEv.payload.contractVersionId, versionNumber: versionEv.payload.versionNumber, documentCommitment: versionEv.payload.documentCommitment, signedAt: versionEv.payload.signedAt }))] : [],
    versionEv ? undefined : (obligationEv ? 'contract version record not found' : missingUpstream));

  // 3 clauses
  const foundClauses = clauseEvs.filter((c) => c.ev !== undefined);
  const lostClauses = clauseEvs.filter((c) => c.ev === undefined).map((c) => c.id);
  push('evidence_clause', foundClauses.length > 0 && lostClauses.length === 0 ? 'present' : 'missing',
    foundClauses.map(({ ev }) => {
      const p = (ev as EventOfType<'EvidenceClauseLinked'>).payload;
      return entry(ev, p.clauseId, `${p.label} (${p.locator}) supports the obligation.`,
        compact({ clauseId: p.clauseId, label: p.label, locator: p.locator, excerptCommitment: p.excerptCommitment, excerptPreview: p.excerptPreview }));
    }),
    !obligationEv ? missingUpstream : foundClauses.length === 0 ? 'no evidence clauses linked' : lostClauses.length > 0 ? `clause(s) not found: ${lostClauses.join(', ')}` : undefined);

  // 4 obligation
  push('approved_obligation', obligationEv ? 'present' : 'missing', obligationEv ? [entry(obligationEv, obligationEv.payload.obligationId,
    `Obligation of ${formatAmount(BigInt(obligationEv.payload.totalMinor), obligationEv.payload.currency)} approved by a human reviewer.`,
    compact({ obligationId: obligationEv.payload.obligationId, description: obligationEv.payload.description, totalMinor: obligationEv.payload.totalMinor, periodCapMinor: obligationEv.payload.periodCapMinor, periodDays: obligationEv.payload.periodDays, approvedBy: obligationEv.payload.approvedBy, approvedAt: obligationEv.payload.approvedAt }))] : [],
    obligationEv ? undefined : (mandateEv ? 'approved obligation not found' : missingUpstream));

  // 5 twin
  push('twin_scenario', twinEv ? 'present' : 'missing', twinEv ? [entry(twinEv, twinEv.payload.scenarioId,
    `Simulation: runway ${twinEv.payload.runwayMonthsBefore} → ${twinEv.payload.runwayMonthsAfter} months.`,
    compact({ scenarioId: twinEv.payload.scenarioId, label: twinEv.payload.label, cashDeltaMinor: twinEv.payload.cashDeltaMinor, monthlyBurnDeltaMinor: twinEv.payload.monthlyBurnDeltaMinor, runwayMonthsBefore: twinEv.payload.runwayMonthsBefore, runwayMonthsAfter: twinEv.payload.runwayMonthsAfter }))] : [],
    twinEv ? undefined : (obligationEv ? 'no twin scenario recorded for this obligation' : missingUpstream));

  // 6 mandate (+ revocation)
  const mandateEntries: ProofEntry[] = [];
  if (mandateEv) {
    const p = mandateEv.payload;
    mandateEntries.push(entry(mandateEv, p.mandateId, `Mandate limits ${formatAmount(BigInt(p.limitMinor), p.currency)} to vendor ${p.vendorId}, approved by a human.`,
      compact({ mandateId: p.mandateId, limitMinor: p.limitMinor, perPaymentLimitMinor: p.perPaymentLimitMinor, periodCapMinor: p.periodCapMinor, periodDays: p.periodDays, startsAt: p.startsAt, expiresAt: p.expiresAt, approvedBy: p.approvedBy, onchainAccount: p.onchainAccount }),
      p.onchainAccount !== undefined ? safeUrl('address', cluster(txEv, settlement), p.onchainAccount) : undefined));
  }
  if (revokeEv) {
    mandateEntries.push(entry(revokeEv, revokeEv.payload.mandateId, 'Mandate was revoked by a human.',
      compact({ revokedBy: revokeEv.payload.revokedBy, reasonText: revokeEv.payload.reasonText, revokedAt: revokeEv.occurredAt })));
  }
  push('mandate', mandateEv ? 'present' : 'missing', mandateEntries, mandateEv ? undefined : `mandate ${intent.mandateId} not found`);

  // 7 delegation
  push('delegation', delegationEv ? 'present' : 'missing', delegationEv ? [entry(delegationEv, delegationEv.payload.delegationId,
    `Agent ${delegationEv.payload.agentId} was delegated to act under the mandate.`,
    compact({ delegationId: delegationEv.payload.delegationId, agentId: delegationEv.payload.agentId, grantedBy: delegationEv.payload.grantedBy }))] : [],
    delegationEv ? undefined : `delegation ${intent.delegationId} not found`);

  // 8 intent
  push('spend_intent', 'present', [entry(intentEvent, intentId, `Agent ${intent.agentId} asked to pay ${amountText} to ${vendorLabel} for task ${intent.taskId}.`,
    compact({ intentId, agentId: intent.agentId, taskId: intent.taskId, vendorId: intent.vendorId, amountMinor: intent.amountMinor, currency: intent.currency, memo: intentEvent.payload.memo }))]);

  // 9 decision
  let reasonCodes: ReasonCode[] | undefined;
  let reasons: string[] | undefined;
  if (decisionEv) {
    const p = decisionEv.payload;
    const params: ReasonParams = p.reasonParams ?? {};
    const ex = explainDecision(p.decision, p.reasonCodes, params);
    reasonCodes = [...p.reasonCodes];
    reasons = [...ex.reasons];
    push('policy_decision', 'present', [entry(decisionEv, p.decisionId, `${ex.headline}.`, compact({ decisionId: p.decisionId, decision: p.decision, evaluatedAt: p.evaluatedAt }))],
      undefined, { reasonCodes, reasons });
  } else {
    push('policy_decision', 'missing', [], 'no policy decision recorded yet');
  }

  // 10–12 on-chain side
  const na = 'No payment was executed because the policy decision rejected it.';
  if (rejected) {
    push('solana_transaction', 'not_applicable', [], na);
    push('settlement', 'not_applicable', [], na);
    push('ledger_entry', 'not_applicable', [], na);
  } else {
    const sig = txEv ? { sig: txEv.payload.signature, cl: txEv.payload.cluster, ev: txEv as AuditEvent, at: txEv.payload.submittedAt }
      : settlement ? { sig: settlement.signature, cl: settlement.cluster, ev: undefined, at: settlement.confirmedAt } : undefined;
    push('solana_transaction', sig ? 'present' : 'missing', sig ? [entry(sig.ev, sig.sig, `Transaction on ${sig.cl} submitted ${sig.at}.`,
      compact({ signature: sig.sig, cluster: sig.cl, submittedAt: sig.at }), safeUrl('tx', sig.cl, sig.sig))] : [],
      sig ? (txEv ? undefined : 'derived from the settlement record; no separate submission event') : (failEv ? 'no transaction was recorded before the failure' : 'transaction not yet submitted'));

    const settleEv = settlement && usable.find((e): e is EventOfType<'SettlementConfirmed'> => e.eventId === settlement.eventId);
    push('settlement', settlement ? 'present' : 'missing', settlement ? [entry(settleEv, settlement.settlementId,
      `Settlement confirmed in slot ${settlement.slot}: ${formatAmount(BigInt(settlement.amountMinor), settlement.currency)} to ${vendorLabel}.`,
      compact({ settlementId: settlement.settlementId, amountMinor: settlement.amountMinor, signature: settlement.signature, cluster: settlement.cluster, slot: settlement.slot, confirmedAt: settlement.confirmedAt }),
      safeUrl('tx', settlement.cluster, settlement.signature))] : [],
      settlement ? undefined : failEv ? `settlement failed: ${privacy === 'public' ? REDACTED : failEv.payload.reasonText}` : 'awaiting on-chain confirmation');

    push('ledger_entry', ledgerEntry ? 'present' : 'missing', ledgerEntry ? [entry(settleEv, ledgerEntry.entryId,
      `Booked: debit ${ledgerEntry.debitAccount}, credit ${ledgerEntry.creditAccount}; reconciled to contract ${ledgerEntry.contractId}, mandate ${ledgerEntry.mandateId}, agent ${ledgerEntry.agentId}, task ${ledgerEntry.taskId}.`,
      compact({ entryId: ledgerEntry.entryId, debitAccount: ledgerEntry.debitAccount, creditAccount: ledgerEntry.creditAccount, amountMinor: ledgerEntry.amountMinor, contractId: ledgerEntry.contractId, obligationId: ledgerEntry.obligationId, mandateId: ledgerEntry.mandateId, agentId: ledgerEntry.agentId, taskId: ledgerEntry.taskId }))] : [],
      ledgerEntry ? undefined : 'no ledger entry because no settlement has been booked');
  }

  if (!integrity.ok) gaps.push(`Audit log integrity: ${integrity.reason ?? 'verification failed'} (sequence ${integrity.brokenAtSequence ?? '?'})`);

  const outcome: TraceOutcome = intent.status === 'settled' ? 'settled' : intent.status === 'rejected' ? 'rejected'
    : intent.status === 'failed' ? 'failed' : intent.status === 'approved' ? 'approved_pending_settlement' : 'awaiting_decision';
  const headline = outcome === 'settled'
    ? `Settled ${amountText} to ${vendorLabel} for task ${intent.taskId} by agent ${intent.agentId} under mandate ${intent.mandateId}.`
    : outcome === 'rejected'
      ? `Rejected ${amountText} payment to ${intent.vendorId} by agent ${intent.agentId}: ${intent.reasonCodes.map(reasonTitle).join('; ') || 'no reason recorded'}.`
      : outcome === 'failed' ? `Approved ${amountText} payment by agent ${intent.agentId} failed to settle.`
        : outcome === 'approved_pending_settlement' ? `Approved ${amountText} payment by agent ${intent.agentId} is awaiting settlement.`
          : `Spend intent of ${amountText} by agent ${intent.agentId} is awaiting a policy decision.`;

  const relatedAnomalies = projection.anomalies().filter((a) => a.params['intentId'] === intentId);
  return {
    traceId: `trace:${intentId}`, intentId, outcome, headline, privacy, steps,
    complete: steps.every((s) => s.status !== 'missing') && integrity.ok, gaps, anomalies: relatedAnomalies, integrity,
  };
}

function cluster(tx: { payload: { cluster: 'localnet' | 'devnet' } } | undefined, s: { cluster: 'localnet' | 'devnet' } | undefined): 'localnet' | 'devnet' {
  return tx?.payload.cluster ?? s?.cluster ?? 'devnet';
}

/** Plain-text rendering for logs, CLIs and tests. FluxShell renders its own UI from the structured trace. */
export function renderTraceText(trace: ProofTrace): string {
  const lines = [trace.headline, ''];
  trace.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} [${s.status}]`);
    for (const e of s.entries) {
      lines.push(`   - ${e.summary}`);
      if (e.explorerUrl) lines.push(`     ${e.explorerUrl}`);
    }
    if (s.reasons) for (const r of s.reasons) lines.push(`   • ${r}`);
    if (s.note) lines.push(`   (${s.note})`);
  });
  for (const a of trace.anomalies) lines.push(`! ${a.code}: ${a.message}`);
  lines.push('', trace.complete ? 'Trace complete.' : `Trace incomplete: ${trace.gaps.join(' | ')}`);
  return lines.join('\n');
}

