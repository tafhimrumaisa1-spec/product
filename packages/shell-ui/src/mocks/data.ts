import type { Mandate } from "../lib/mandate";
export interface Obligation { id: string; label: string; clause: string; valueCents: number; confidence: number; status: "pending" | "approved" | "flagged"; }
export interface FluxApi {
  getObligations(): Promise<Obligation[]>; getMandate(): Promise<Mandate>;
  getTwin(): Promise<{ cashCents: number; burnCents: number; scenarios: { name: string; burnDeltaCents: number }[] }>;
  getAgents(): Promise<{ id: string; task: string; spentCents: number; capCents: number; value: string }[]>;
  getProof(): Promise<{ step: string; ref: string; state: "ok" | "rejected" }[]>;
}
const mandate: Mandate = { id: "mnd_demo_01", contractId: "ctr_nimbus_compute", obligationId: "obl_03", agentId: "agent_infra_ops", vendor: "Nimbus Compute (synthetic)", maxPerPaymentCents: 1_500_000, capPerPeriodCents: 4_000_000, spentInPeriodCents: 0, status: "draft" };
// Synthetic data only. Host applications replace this adapter with real modules.
export const demoApi: FluxApi = {
  getObligations: async () => [
    { id: "obl_01", label: "Vendor", clause: "§1 Parties", valueCents: 0, confidence: 0.99, status: "approved" },
    { id: "obl_02", label: "Contract value, 12 months", clause: "§3.1 Fees", valueCents: 48_000_000, confidence: 0.96, status: "approved" },
    { id: "obl_03", label: "Monthly payment, capped", clause: "§3.2 Schedule", valueCents: 4_000_000, confidence: 0.91, status: "pending" },
    { id: "obl_04", label: "Auto-renewal, 30-day notice", clause: "§7 Renewal", valueCents: 0, confidence: 0.72, status: "flagged" }
  ],
  getMandate: async () => ({ ...mandate }),
  getTwin: async () => ({ cashCents: 180_000_000, burnCents: 22_000_000, scenarios: [
    { name: "Contract as signed", burnDeltaCents: 4_000_000 }, { name: "Renewal declined", burnDeltaCents: 0 }, { name: "Usage +40%", burnDeltaCents: 5_600_000 }
  ] }),
  getAgents: async () => [{ id: "agent_infra_ops", task: "Provision GPU batch", spentCents: 2_400_000, capCents: 4_000_000, value: "Model training job completed" }],
  getProof: async () => [
    { step: "Contract committed", ref: "salted commitment (mock hash)", state: "ok" },
    { step: "Obligation approved by a human", ref: "reviewer: demo-user", state: "ok" },
    { step: "Mandate registered", ref: "devnet:MOCK_MANDATE_ACCOUNT", state: "ok" },
    { step: "Payment of $12,000 authorized", ref: "devnet:MOCK_SIG_1", state: "ok" },
    { step: "Payment of $40,000 rejected: over per-payment limit", ref: "no transaction sent", state: "rejected" }
  ]
};
