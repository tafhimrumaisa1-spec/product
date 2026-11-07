import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEVNET_NETWORK_ID,
  isFluxFlowError,
  mockAddress,
  x402V2ToPaymentRequest,
  type X402V2Requirement,
} from '../src/index.js';

const mint = mockAddress('xMint');
const vendor = mockAddress('xVendor');
const base: X402V2Requirement = {
  x402Version: 2,
  scheme: 'exact',
  network: DEVNET_NETWORK_ID,
  asset: mint,
  amount: '1260000000',
  payTo: vendor,
  resource: 'https://vendor.example/compute',
};
const context = {
  paymentId: 'x402:challenge:001',
  mandateId: 'mandate:compute',
  taskId: 'task:inference:001',
  agentId: 'agent:buyer:001',
};

describe('x402 V2 mandate bridge', () => {
  it('maps an exact Devnet challenge into the canonical FluxFlow request', () => {
    assert.deepEqual(x402V2ToPaymentRequest(base, context), {
      ...context,
      network: DEVNET_NETWORK_ID,
      mint,
      recipient: vendor,
      amount: 1_260_000_000n,
    });
  });

  it('rejects non-V2, non-exact and non-Devnet requirements', () => {
    for (const requirement of [
      { ...base, x402Version: 1 },
      { ...base, scheme: 'upto' },
      { ...base, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
    ]) {
      assert.throws(
        () => x402V2ToPaymentRequest(requirement as X402V2Requirement, context),
        (error) => isFluxFlowError(error),
      );
    }
  });

  it('rejects zero, signed, fractional and padded amounts', () => {
    for (const amount of ['0', '-1', '+1', '1.5', '01', '']) {
      assert.throws(
        () => x402V2ToPaymentRequest({ ...base, amount }, context),
        (error) => isFluxFlowError(error) && error.code === 'INVALID_AMOUNT',
      );
    }
  });

  it('validates the requested mint and recipient as Solana addresses', () => {
    assert.throws(() => x402V2ToPaymentRequest({ ...base, asset: 'USDC' }, context));
    assert.throws(() => x402V2ToPaymentRequest({ ...base, payTo: 'vendor' }, context));
  });
});
