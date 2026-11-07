// UI-side mirror only. Authoritative enforcement belongs to FluxMandate on Solana.
export type MandateStatus = "draft" | "active" | "revoked";
export interface Mandate {
  id: string; contractId: string; obligationId: string; agentId: string; vendor: string;
  maxPerPaymentCents: number; capPerPeriodCents: number; spentInPeriodCents: number; status: MandateStatus;
}
export type RejectReason = "INVALID_AMOUNT" | "MANDATE_NOT_ACTIVE" | "VENDOR_MISMATCH" | "PER_PAYMENT_LIMIT" | "PERIOD_CAP";
export type Decision = { ok: true } | { ok: false; reason: RejectReason };
export function evaluatePayment(mandate: Mandate, vendor: string, amountCents: number): Decision {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, reason: "INVALID_AMOUNT" };
  if (mandate.status !== "active") return { ok: false, reason: "MANDATE_NOT_ACTIVE" };
  if (vendor !== mandate.vendor) return { ok: false, reason: "VENDOR_MISMATCH" };
  if (amountCents > mandate.maxPerPaymentCents) return { ok: false, reason: "PER_PAYMENT_LIMIT" };
  if (mandate.spentInPeriodCents + amountCents > mandate.capPerPeriodCents) return { ok: false, reason: "PERIOD_CAP" };
  return { ok: true };
}
export function runwayMonths(cashCents: number, monthlyBurnCents: number): number | null {
  if (!Number.isSafeInteger(cashCents) || !Number.isSafeInteger(monthlyBurnCents) || cashCents < 0 || monthlyBurnCents <= 0) return null;
  return Math.floor((cashCents / monthlyBurnCents) * 10) / 10;
}
export const usd = (cents: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
