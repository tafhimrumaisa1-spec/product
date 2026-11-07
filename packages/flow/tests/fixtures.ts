import {
  InMemoryReceiptStore,
  createMockEnvironment,
  createPaymentExecutor,
  createSettlementVerifier,
  localConfig,
  mockAddress,
  mockWallet,
  seedMockDemo,
  isFluxFlowError,
  type FluxFlowErrorCode,
  type MandateRecord,
  type PaymentRequest,
} from '../src/index.js';

export async function setup(overrides: Partial<MandateRecord> = {}, timing: { confirmTimeoutMs?: number; pollIntervalMs?: number } = {}) {
  const env = createMockEnvironment();
  const demo = await seedMockDemo(env);
  if (Object.keys(overrides).length > 0) env.registry.put({ ...demo.mandate, ...overrides });
  const config = localConfig({ allowedMints: [demo.mint], confirmTimeoutMs: timing.confirmTimeoutMs ?? 5_000, pollIntervalMs: timing.pollIntervalMs ?? 500 });
  const store = new InMemoryReceiptStore();
  const executor = createPaymentExecutor({
    config,
    registry: env.registry,
    delegation: env.delegation,
    chain: env.chain,
    store,
    verifier: createSettlementVerifier(env.chain),
    agentWallet: mockWallet('delegatee', demo.delegatee),
    clock: env.clock,
    allowBrowserRuntime: true,
  });
  const request = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
    paymentId: 'pay-1',
    mandateId: demo.mandate.mandateId,
    taskId: 'task-1',
    agentId: demo.mandate.agentId,
    network: env.network,
    mint: demo.mint,
    recipient: demo.vendor,
    amount: 200_000n,
    ...over,
  });
  return { env, demo, config, store, executor, request };
}

export async function codeOf(p: Promise<unknown>): Promise<FluxFlowErrorCode | 'NO_ERROR' | 'NON_FLUX_ERROR'> {
  try {
    await p;
    return 'NO_ERROR';
  } catch (e) {
    return isFluxFlowError(e) ? e.code : 'NON_FLUX_ERROR';
  }
}

export { mockAddress };
