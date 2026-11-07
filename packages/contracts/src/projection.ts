import { err, ok, type ApprovedObligationSet, type IsoDate, type Result } from './types.js';
import type { CapPeriod } from './types.js';

/**
 * Read-only projections of an ApprovedObligationSet for sibling modules.
 * These are the ONLY shapes FluxMandate / FluxTwin should consume from FluxContracts;
 * they never see the contract text.
 */

export interface MandateTerms {
  readonly contractId: string;
  readonly commitment: string;
  readonly vendorName: string;
  readonly customerName: string;
  readonly currency: string;
  readonly totalCapMinor: number;
  readonly periodCapMinor: number;
  readonly period: CapPeriod;
  readonly validFrom: IsoDate;
  /** Inclusive. Auto-renewal does NOT extend authority: a renewal needs a new review + mandate. */
  readonly validTo: IsoDate;
  readonly autoRenewalExtendsMandate: false;
  readonly terminationNoticeDays: number | null;
}

export interface Cashflow {
  readonly obligationId: string;
  readonly date: IsoDate;
  /** Outflow, positive integer minor units. */
  readonly amountMinor: number;
  readonly currency: string;
}

export function toMandateTerms(set: ApprovedObligationSet): Result<MandateTerms> {
  const find = <K extends ApprovedObligationSet['obligations'][number]['terms']['kind']>(k: K) =>
    set.obligations.find((o) => o.terms.kind === k)?.terms as Extract<
      ApprovedObligationSet['obligations'][number]['terms'],
      { kind: K }
    > | undefined;
  const parties = find('PARTIES');
  const total = find('TOTAL_VALUE');
  const cap = find('PERIODIC_CAP');
  const term = find('TERM');
  const termination = find('TERMINATION');
  if (!parties || !total || !cap || !term) {
    return err('MISSING_REQUIRED', 'approved set lacks parties, total, cap or term');
  }
  if (total.total.currency !== cap.cap.currency) return err('INVALID_INPUT', 'total and cap currencies differ');
  return ok({
    contractId: set.contractId,
    commitment: set.commitment.value,
    vendorName: parties.vendor,
    customerName: parties.customer,
    currency: total.total.currency,
    totalCapMinor: total.total.amountMinor,
    periodCapMinor: cap.cap.amountMinor,
    period: cap.period,
    validFrom: term.startDate,
    validTo: term.endDate,
    autoRenewalExtendsMandate: false,
    terminationNoticeDays: termination?.noticeDays ?? null,
  });
}

export function toCashflows(set: ApprovedObligationSet): Result<readonly Cashflow[]> {
  const o = set.obligations.find((x) => x.terms.kind === 'PAYMENT_SCHEDULE');
  if (!o || o.terms.kind !== 'PAYMENT_SCHEDULE') return err('MISSING_REQUIRED', 'approved set lacks a payment schedule');
  return ok(
    [...o.terms.installments]
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
      .map((i) => ({ obligationId: o.id, date: i.dueDate, amountMinor: i.amount.amountMinor, currency: i.amount.currency })),
  );
}
