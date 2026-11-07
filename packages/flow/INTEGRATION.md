# FluxFlow integration

This package is the reviewed, mock-first payment execution boundary for the
FluxMandate demo. It was imported from the Agent 06 delivery without claiming
that its optional real Solana adapters have been validated on-chain.

## Verified locally

- Strict TypeScript covers `src/` and `tests/`.
- Mock execution validates network, mint, recipient, mandate state, allowance,
  balance, expiry, replay protection, confirmation, and settlement evidence.
- Signers are injected through opaque interfaces; the package does not create,
  serialize, log, or read private keys.
- Browser construction is refused for the real executor. UI work must use the
  mock environment or call a server-side route.

Run from this directory:

```bash
npm install
npm run typecheck
npm test
```

## Integration boundary

The canonical app should consume `@fluxmandate/flow` through a server-only
service. FluxMandate must implement `MandateRegistryClient`; FluxLedger should
consume successful `SettlementReceipt` values and rejected policy decisions.
The deterministic mock is the authoritative path for the offline/replay demo.

## Not yet proven

- The optional `@solana/kit` and `@solana/subscriptions` adapters are shaped
  from documentation and recording fakes, not a live SDK installation.
- No local validator or Devnet transaction has been executed by this package.
- The in-memory receipt store is not durable across processes.
- Post-send RPC timeouts require a future reconciliation worker.
- Token-2022 fee/hook mints and sponsored fee payers are unsupported.
- The x402 example and MPP adapter are roadmap-only and outside the critical
  payment path.

Do not describe these limitations as completed functionality in the demo or
submission materials.
