/**
 * Deterministic, synthetic fixtures. Everything here is fake: the contract is synthetic, amounts are
 * Devnet-style test units, and transaction signatures/addresses are derived from SHA-256 of fixed
 * strings. They have the right SHAPE for explorer links but DO NOT exist on any cluster.
 * The commitment salt below is a public fixture value, not a secret.
 */
import { type AuditEvent, type AuditEventInput, type AuditEventType, EVENT_SCHEMA_VERSION } from './events.js';
import { LedgerProjection } from './ledger.js';
import { toMinor } from './money.js';
import type { PolicyEvaluation } from './policy.js';
import { type ReasonCode, ReasonCodes } from './reasons.js';
import { createSaltedCommitment } from './redaction.js';
import { sha256Bytes } from './sha256.js';
import { type EventStore, InMemoryEventStore } from './store.js';

export type FixtureName = 'success' | 'over_limit' | 'revoked_mandate' | 'mismatched_vendor';
export const FIXTURE_NAMES: readonly FixtureName[] = ['success', 'over_limit', 'revoked_mandate', 'mismatched_vendor'];

export const FIXTURE_IDS = {
  contractId: 'ctr_acme_compute_001', contractVersionId: 'ctv_acme_compute_001_v1', vendorId: 'vendor_acme_compute',
  vendorName: 'Acme Compute Services (synthetic)', clauseFees: 'cl_fees', clauseCap: 'cl_monthly_cap', clauseTerm: 'cl_term',
  obligationId: 'obl_acme_compute_q4', scenarioId: 'twin_acme_q4', mandateId: 'mdt_acme_compute_q4',
  delegationId: 'dlg_agent_buyer_q4', agentId: 'agent_compute_buyer', taskId: 'task_train_batch_42',
  approver: 'human:finance_lead_01', otherVendorId: 'vendor_unlisted_gpu',
} as const;

const FIXTURE_SALT = 'fixture-salt-not-secret-0001';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58.charAt(Number(n % 58n)) + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}
/** Synthetic 64-byte "signature" in base58 (86–88 chars). Not a real transaction. */
export function syntheticSignature(seed: string): string {
  const a = sha256Bytes(`sig:a:${seed}`), b = sha256Bytes(`sig:b:${seed}`);
  const both = new Uint8Array(64); both.set(a); both.set(b, 32);
  return base58(both);
}
/** Synthetic 32-byte "address" in base58 (43–44 chars). Not a real account. */
export function syntheticAddress(seed: string): string { return base58(sha256Bytes(`addr:${seed}`)); }

export interface FixtureExpectation {
  decision: 'approved' | 'rejected';
  reasonCodes: ReasonCode[];
  outcome: 'settled' | 'rejected';
  settlementId?: string;
}
export interface Fixture {
  name: FixtureName;
  description: string;
  events: AuditEvent[];
  /** The spend intent this fixture is "about" (the last one submitted). */
  intentId: string;
  expected: FixtureExpectation;
}

type InputOf<T extends AuditEventType> = Extract<AuditEventInput, { type: T }>;

class Builder {
  readonly proj = new LedgerProjection();
  readonly events: AuditEvent[] = [];
  private n = 0;
  constructor(private readonly name: string, private readonly store: EventStore) {}

  async emit<T extends AuditEventType>(type: T, occurredAt: string, source: string, payload: InputOf<T>['payload']): Promise<AuditEvent> {
    this.n += 1;
    const input = {
      eventId: `fx_${this.name}_${String(this.n).padStart(3, '0')}`, type, occurredAt, schemaVersion: EVENT_SCHEMA_VERSION, source, payload,
    } as unknown as AuditEventInput;
    const { event } = await this.store.append(input);
    this.proj.apply(event);
    this.events.push(event);
    return event;
  }

  async decide(intentId: string, intent: InputOf<'SpendIntentSubmitted'>['payload'], at: string): Promise<PolicyEvaluation> {
    const ev = this.proj.evaluateIntent(intent, at);
    await this.emit('PolicyDecisionRecorded', at, 'FluxMandate', {
      decisionId: `dec_${intentId}`, intentId, decision: ev.decision, reasonCodes: ev.reasonCodes, reasonParams: ev.reasonParams, evaluatedAt: at,
    });
    return ev;
  }
}

const I = FIXTURE_IDS;
const T = (decimal: string): string => toMinor(decimal);

async function baseline(b: Builder): Promise<void> {
  const doc = createSaltedCommitment('synthetic-compute-services-agreement-v1', FIXTURE_SALT);
  await b.emit('ContractRegistered', '2026-10-20T15:00:00Z', 'FluxContracts', {
    contractId: I.contractId, vendorId: I.vendorId, vendorName: I.vendorName, title: 'Compute Services Agreement (synthetic)', documentCommitment: doc, synthetic: true,
  });
  await b.emit('ContractVersionRecorded', '2026-10-20T15:05:00Z', 'FluxContracts', {
    contractVersionId: I.contractVersionId, contractId: I.contractId, versionNumber: 1, documentCommitment: doc, signedAt: '2026-10-20T14:30:00Z',
  });
  const clauses: [string, string, string, string][] = [
    [I.clauseFees, 'Fees', '§4.1', 'Customer shall pay Provider up to 12,000 USDC over the Term.'],
    [I.clauseCap, 'Monthly cap', '§4.3', 'Fees in any 30-day period shall not exceed 4,000 USDC.'],
    [I.clauseTerm, 'Term', '§2.1', 'The Term runs from 1 November 2026 to 31 January 2027.'],
  ];
  for (const [clauseId, label, locator, text] of clauses) {
    await b.emit('EvidenceClauseLinked', '2026-10-20T15:10:00Z', 'FluxContracts', {
      clauseId, contractVersionId: I.contractVersionId, label, locator, excerptCommitment: createSaltedCommitment(text, FIXTURE_SALT), excerptPreview: text,
    });
  }
  await b.emit('ObligationApproved', '2026-10-21T09:00:00Z', 'FluxContracts', {
    obligationId: I.obligationId, contractId: I.contractId, contractVersionId: I.contractVersionId, clauseIds: [I.clauseFees, I.clauseCap, I.clauseTerm],
    vendorId: I.vendorId, description: 'GPU compute services, Nov 2026 – Jan 2027', currency: 'USDC', totalMinor: T('12000'),
    periodCapMinor: T('4000'), periodDays: 30, approvedBy: I.approver, approvedAt: '2026-10-21T09:00:00Z',
  });
  await b.emit('TwinScenarioRecorded', '2026-10-21T09:30:00Z', 'FluxTwin', {
    scenarioId: I.scenarioId, obligationIds: [I.obligationId], label: 'Acme compute commitment', cashDeltaMinor: `-${T('12000')}`,
    monthlyBurnDeltaMinor: T('4000'), runwayMonthsBefore: 14.2, runwayMonthsAfter: 11.6,
  });
  await b.emit('MandateCreated', '2026-10-31T18:00:00Z', 'FluxMandate', {
    mandateId: I.mandateId, obligationId: I.obligationId, contractId: I.contractId, vendorId: I.vendorId, currency: 'USDC',
    limitMinor: T('12000'), perPaymentLimitMinor: T('2500'), periodCapMinor: T('4000'), periodDays: 30,
    startsAt: '2026-11-01T00:00:00Z', expiresAt: '2027-01-31T23:59:59Z', twinScenarioId: I.scenarioId, approvedBy: I.approver,
    onchainAccount: syntheticAddress('mandate-account'),
  });
  await b.emit('DelegationGranted', '2026-10-31T18:05:00Z', 'FluxMandate', {
    delegationId: I.delegationId, mandateId: I.mandateId, agentId: I.agentId, grantedBy: I.approver,
  });
}

function intentPayload(intentId: string, amount: string, vendorId: string = I.vendorId): InputOf<'SpendIntentSubmitted'>['payload'] {
  return {
    intentId, mandateId: I.mandateId, delegationId: I.delegationId, agentId: I.agentId, taskId: I.taskId, vendorId,
    currency: 'USDC', amountMinor: T(amount), memo: 'Reserve GPU hours for batch 42 (synthetic)',
  };
}

async function authorizedPayment(b: Builder, intentId: string, amount: string): Promise<void> {
  const at = '2026-11-07T10:00:00Z';
  const p = intentPayload(intentId, amount);
  await b.emit('SpendIntentSubmitted', at, 'FluxFlow', p);
  await b.decide(intentId, p, at);
  const signature = syntheticSignature(`settlement:${intentId}`);
  await b.emit('TransactionSubmitted', '2026-11-07T10:00:05Z', 'FluxFlow', { intentId, signature, cluster: 'devnet', submittedAt: '2026-11-07T10:00:05Z' });
  await b.emit('SettlementConfirmed', '2026-11-07T10:00:12Z', 'FluxFlow', {
    settlementId: `stl_${intentId}`, intentId, signature, cluster: 'devnet', vendorId: I.vendorId, currency: 'USDC', amountMinor: T(amount), slot: 412_345_678, confirmedAt: '2026-11-07T10:00:12Z',
  });
  await b.emit('TaskRevenueRecorded', '2026-11-07T12:00:00Z', 'FluxFlow', {
    revenueId: `rev_${I.taskId}_1`, taskId: I.taskId, currency: 'USDC', amountMinor: T('1800'), customerRef: 'customer_synthetic_17', recordedAt: '2026-11-07T12:00:00Z',
  });
}

export async function buildFixture(name: FixtureName, store: EventStore = new InMemoryEventStore()): Promise<Fixture> {
  const b = new Builder(name, store);
  await baseline(b);
  switch (name) {
    case 'success':
      await authorizedPayment(b, 'int_0001', '1000');
      return {
        name, description: 'Agent pays 1,000 USDC inside the mandate; settled, reconciled and revenue recorded for the task.',
        events: b.events, intentId: 'int_0001',
        expected: { decision: 'approved', reasonCodes: [ReasonCodes.APPROVED_WITHIN_MANDATE], outcome: 'settled', settlementId: 'stl_int_0001' },
      };
    case 'over_limit': {
      await authorizedPayment(b, 'int_0001', '1000');
      const at = '2026-11-07T11:00:00Z';
      const p = intentPayload('int_0002', '3500');
      await b.emit('SpendIntentSubmitted', at, 'FluxFlow', p);
      await b.decide('int_0002', p, at);
      return {
        name, description: 'After a valid 1,000 USDC payment, the agent tries 3,500 USDC: above the 2,500 per-payment limit and the 4,000 period cap. Rejected, nothing executed.',
        events: b.events, intentId: 'int_0002',
        expected: { decision: 'rejected', reasonCodes: [ReasonCodes.PER_PAYMENT_LIMIT_EXCEEDED, ReasonCodes.PERIOD_CAP_EXCEEDED], outcome: 'rejected' },
      };
    }
    case 'revoked_mandate': {
      await b.emit('MandateRevoked', '2026-11-05T08:00:00Z', 'FluxMandate', { mandateId: I.mandateId, revokedBy: I.approver, reasonText: 'Vendor under security review (synthetic)' });
      const at = '2026-11-07T10:00:00Z';
      const p = intentPayload('int_0001', '500');
      await b.emit('SpendIntentSubmitted', at, 'FluxFlow', p);
      await b.decide('int_0001', p, at);
      return {
        name, description: 'A human revoked the mandate; the agent then asks to pay 500 USDC and is rejected.',
        events: b.events, intentId: 'int_0001', expected: { decision: 'rejected', reasonCodes: [ReasonCodes.MANDATE_REVOKED], outcome: 'rejected' },
      };
    }
    case 'mismatched_vendor': {
      const at = '2026-11-07T10:00:00Z';
      const p = intentPayload('int_0001', '500', I.otherVendorId);
      await b.emit('SpendIntentSubmitted', at, 'FluxFlow', p);
      await b.decide('int_0001', p, at);
      return {
        name, description: 'The agent tries to pay a vendor that is not the contract counterparty; rejected.',
        events: b.events, intentId: 'int_0001', expected: { decision: 'rejected', reasonCodes: [ReasonCodes.VENDOR_MISMATCH], outcome: 'rejected' },
      };
    }
    default: {
      const unreachable: never = name;
      throw new Error(`Unknown fixture ${String(unreachable)}`);
    }
  }
}
