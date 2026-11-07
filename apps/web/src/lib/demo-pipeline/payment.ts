import {
  InMemoryReceiptStore,
  createMockEnvironment,
  createPaymentExecutor,
  createSettlementVerifier,
  isFluxFlowError,
  localConfig,
  mockWallet,
  seedMockDemo,
  type SettlementReceipt,
} from "../../../../../packages/flow/src/index";

export type DemoPaymentScenario = "authorized" | "over_cap";

export interface DemoPaymentResult {
  mode: "deterministic_mock";
  synthetic: true;
  onchain: false;
  scenario: DemoPaymentScenario;
  outcome: "settled" | "rejected";
  sentTransactions: number;
  receipt?: JsonReceipt;
  rejection?: { code: string; message: string };
  notice: string;
}

type JsonReceipt = Omit<SettlementReceipt, "network" | "mint" | "recipient" | "delegator" | "delegatee" | "signature"> & {
  network: string;
  mint: string;
  recipient: string;
  delegator: string;
  delegatee: string;
  signature: string;
};

/**
 * A fresh environment is built for every call, making this safe for a
 * sessionless public demo. Nothing is persisted and no wallet signer exists.
 */
export async function runDemoPayment(scenario: DemoPaymentScenario): Promise<DemoPaymentResult> {
  const env = createMockEnvironment();
  const demo = await seedMockDemo(env);
  const executor = createPaymentExecutor({
    config: localConfig({ allowedMints: [demo.mint], confirmTimeoutMs: 5_000, pollIntervalMs: 100 }),
    registry: env.registry,
    delegation: env.delegation,
    chain: env.chain,
    store: new InMemoryReceiptStore(),
    verifier: createSettlementVerifier(env.chain),
    agentWallet: mockWallet("delegatee", demo.delegatee),
    clock: env.clock,
  });

  const amount = scenario === "authorized" ? 200_000n : 600_000n;
  try {
    const receipt = await executor.execute({
      paymentId: `demo:${scenario}:payment`,
      mandateId: demo.mandate.mandateId,
      taskId: "task:synthetic-compute-001",
      agentId: demo.mandate.agentId,
      network: env.network,
      mint: demo.mint,
      recipient: demo.vendor,
      amount,
    });
    return {
      mode: "deterministic_mock",
      synthetic: true,
      onchain: false,
      scenario,
      outcome: "settled",
      sentTransactions: env.sentCount(),
      receipt: { ...receipt },
      notice: "Mock settlement only. No Devnet transaction or real funds were used.",
    };
  } catch (error) {
    if (!isFluxFlowError(error)) throw error;
    return {
      mode: "deterministic_mock",
      synthetic: true,
      onchain: false,
      scenario,
      outcome: "rejected",
      sentTransactions: env.sentCount(),
      rejection: { code: error.code, message: error.message },
      notice: "Deterministic policy rejection. No transaction was submitted.",
    };
  }
}

export function parsePaymentScenario(value: unknown): DemoPaymentScenario | null {
  return value === "authorized" || value === "over_cap" ? value : null;
}
