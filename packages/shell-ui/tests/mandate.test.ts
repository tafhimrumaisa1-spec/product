import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePayment, runwayMonths, type Mandate } from "../src/lib/mandate.ts";

const mandate: Mandate = {
  id: "m", contractId: "c", obligationId: "o", agentId: "a", vendor: "V",
  maxPerPaymentCents: 1_500, capPerPeriodCents: 4_000, spentInPeriodCents: 0, status: "active",
};

test("authorizes an in-limit integer-cent payment", () => assert.deepEqual(evaluatePayment(mandate, "V", 1_200), { ok: true }));
test("rejects the per-payment limit", () => assert.deepEqual(evaluatePayment(mandate, "V", 1_600), { ok: false, reason: "PER_PAYMENT_LIMIT" }));
test("rejects the period cap", () => assert.deepEqual(evaluatePayment({ ...mandate, spentInPeriodCents: 3_000 }, "V", 1_200), { ok: false, reason: "PERIOD_CAP" }));
test("rejects inactive mandates", () => assert.deepEqual(evaluatePayment({ ...mandate, status: "draft" }, "V", 1), { ok: false, reason: "MANDATE_NOT_ACTIVE" }));
test("rejects vendor mismatches", () => assert.deepEqual(evaluatePayment(mandate, "X", 1), { ok: false, reason: "VENDOR_MISMATCH" }));
test("rejects invalid amounts", () => {
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.deepEqual(evaluatePayment(mandate, "V", amount), { ok: false, reason: "INVALID_AMOUNT" });
});
test("calculates runway without floating money", () => {
  assert.equal(runwayMonths(1_000, 100), 10);
  assert.equal(runwayMonths(1_000, 0), null);
  assert.equal(runwayMonths(-1, 100), null);
});
