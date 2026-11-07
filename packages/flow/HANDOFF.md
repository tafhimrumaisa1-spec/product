# HANDOFF.md — FluxFlow (Agent 06)

## 1. What was built

An isolated strict-TypeScript package that executes mandate-bound payments:

1. validate request ↔ mandate ↔ network ↔ mint ↔ recipient ↔ allowance ↔ balance (pre-flight);
2. have the **agent's** delegatee wallet pull funds through a Subscriptions-program delegation;
3. confirm the transaction per Solana's documented expiry/commitment rules;
4. verify settlement from on-chain token-balance deltas;
5. emit a `SettlementReceipt` linking contract, obligation, mandate, agent and task for FluxLedger / FluxProof.

Golden-demo coverage: step 6 (authorized payment), step 7 (over-mandate payment rejected — pre-flight, and again by the program), step 8/9 inputs (receipt + signature).

Not built (by design): mandate registry / on-chain registry (FluxMandate), contract extraction, simulation, ledger, proof UI, subscription plans, MPP sessions, x402 as a payment path.

## 2. Public interfaces (`source/src/interfaces.ts`, re-exported from `index.ts`)

| Interface | Purpose |
|---|---|
| `WalletConnection` | `{ role: 'delegator'\|'delegatee', address, network, signer: OpaqueSigner }`. Signers are **injected**; FluxFlow never creates, stores, logs or serialises key material. |
| `MandateRegistryClient` | `getMandate(id): Promise<MandateRecord \| null>`. FluxMandate implements; FluxFlow ships a mock. |
| `DelegationClient` | `createFixed`, `createRecurring`, `getState`, `getRemainingAllowance`, `revoke`, `pull`. |
| `PaymentExecutor` | `execute(PaymentRequest): Promise<SettlementReceipt>` — created by `createPaymentExecutor(deps)`. |
| `SettlementVerifier` | `verify(ExpectedSettlement): Promise<{ ok, failures[] }>` — `createSettlementVerifier(chainReader)`. |
| `ChainReader` | RPC port: network, token balance, signature status, block height, transfer evidence. |
| `ReceiptStore` | Replay/duplicate prevention port (`reserve`, `markSubmitted`, `commit`, `release`, `get`). |
| `SettlementReceipt` | JSON-safe, secret-free evidence record (amounts as decimal strings). |

Other exports: `localConfig()`, `devnetConfig()`, `parseNetworkId()`, `computeRemaining()`, `confirmTransaction()`, `InMemoryReceiptStore`, `FluxFlowError` + `FluxFlowErrorCode`, mock environment (`createMockEnvironment`, `seedMockDemo`, `createFakeClock`, `mockWallet`, `mockAddress`), `createSubscriptionsDelegationClient`, `createKitChainReader`, `createMppSessionAdapter` (roadmap stub).

### Error codes (stable, for FluxShell business-language messages)

`WRONG_NETWORK`, `WRONG_MINT`, `WRONG_RECIPIENT`, `WRONG_AGENT`, `CAP_EXCEEDED`, `INSUFFICIENT_BALANCE`, `MANDATE_NOT_FOUND`, `MANDATE_NOT_ACTIVE`, `MANDATE_NOT_APPROVED`, `MANDATE_EXPIRED`, `DELEGATION_REVOKED`, `DELEGATION_EXPIRED`, `DELEGATION_NOT_STARTED`, `REPLAY_DETECTED`, `RPC_TIMEOUT`, `BLOCKHASH_EXPIRED`, `TX_FAILED`, `PROGRAM_REJECTED`, `SETTLEMENT_MISMATCH`, `EVIDENCE_UNAVAILABLE`, `INVALID_*`, `UNSUPPORTED_NETWORK`, `BROWSER_SIGNER_FORBIDDEN`, `NOT_IMPLEMENTED`, `ADAPTER_CONTRACT`.

### Idempotency and failure semantics (important for FluxLedger)

- `paymentId` is the idempotency key; it settles at most once.
- Released (retry allowed): any failure **before** a transaction is sent; `PROGRAM_REJECTED` from `pull`; `BLOCKHASH_EXPIRED`; `TX_FAILED`.
- **Kept reserved** (outcome unknown or money may have moved): `RPC_TIMEOUT` after a send attempt, `SETTLEMENT_MISMATCH`. These need reconciliation by signature; FluxFlow does not auto-resume (see limitations).

## 3. How to run

```bash
cd source
npm run typecheck
npm test
```

Mock executor wiring (this is what the tests use — see `tests/fixtures.ts`):

```ts
const env = createMockEnvironment();
const demo = await seedMockDemo(env);
const executor = createPaymentExecutor({
  config: localConfig({ allowedMints: [demo.mint] }),
  registry: env.registry, delegation: env.delegation, chain: env.chain,
  store: new InMemoryReceiptStore(), verifier: createSettlementVerifier(env.chain),
  agentWallet: mockWallet('delegatee', demo.delegatee),
  clock: env.clock, allowBrowserRuntime: true,   // mock only
});
const receipt = await executor.execute({ paymentId, mandateId, taskId, agentId, network: env.network, mint, recipient, amount: 200_000n });
```

Real wiring (server-side only; **unverified against real SDK types** — see ASSUMPTIONS.md):

```ts
const delegatorClient = createClient().use(signer(delegatorSigner)).use(solanaLocalRpc({ rpcUrl })).use(subscriptionsProgram());
const agentClient     = createClient().use(signer(agentSigner)).use(solanaLocalRpc({ rpcUrl })).use(subscriptionsProgram());
const delegation = createSubscriptionsDelegationClient({
  sdk: { tokenProgramAddress: TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, findSubscriptionAuthorityPda,
         findFixedDelegationPda, findRecurringDelegationPda, fetchMaybeSubscriptionAuthority },
  delegatorClient, agentClient, delegatorWallet, agentWallet,
  readers: { readFixed, readRecurring },       // decode the delegation PDAs (fields per ADR-001)
});
const chain = createKitChainReader({ rpc: createSolanaRpc(rpcUrl), deriveAta });
```

The delegator (treasury) wallet is only needed for `createFixed/createRecurring/revoke` — run those from a wallet-approval flow, not inside the agent process. `createPaymentExecutor` never receives the delegator signer.

## 4. Dependencies required

- **Compile/test:** TypeScript ≥ 5.5 (tested with the installed `tsc` 7.0.2), `tsx`, Node (tested on v22.23.4). **No runtime npm dependencies.**
- **Real adapters (optional peers, install separately, pin versions at integration):** `@solana/kit`, `@solana/kit-plugin-rpc`, `@solana/kit-plugin-signer`, `@solana/subscriptions`, `@solana-program/token`.
- **Chain prerequisites:** the Subscriptions program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) on the target cluster (local: install via Surfpool per the program repo); funded delegator token account; recipient associated token account; Devnet mint (Devnet USDC default `4zMM…DncDU`).
- **x402 example only:** `@x402/core @x402/express @x402/fetch @x402/svm express @scure/base @solana/kit`, a V2 facilitator, disposable Devnet keys from the environment.

## 5. Tests performed

See `TEST_REPORT.md`. Summary: strict typecheck clean; 50/50 `node:test` tests pass against mocks and a recording fake of the documented SDK shape. **Nothing was run on-chain, and the real Kit/Subscriptions packages were never installed.**

## 6. Known limitations

1. Real adapters are untested against real SDKs/validator; return shape of `sendTransaction()`, single-account decoding, and package versions are assumptions (ASSUMPTIONS.md #1–#6).
2. `RPC_TIMEOUT` after sending leaves the key reserved; no `resume(paymentId)` reconciliation is implemented.
3. `InMemoryReceiptStore` is single-process; production needs a durable atomic store.
4. Exact-amount verification means Token-2022 transfer-fee mints are unsupported.
5. Remaining-allowance maths is advisory; the program decides.
6. `humanApprovalRef` presence is checked, not its authenticity.
7. `getTokenBalance` in the Kit reader cannot tell "no token account" from an RPC failure.
8. x402 example not compiled/run; MPP is interface-only.
9. `local` cannot be fingerprinted beyond rejecting the Mainnet genesis reference.

## 7. Integration requirements

- **FluxMandate:** implement `MandateRegistryClient` returning `MandateRecord` (field set is FluxFlow's proposal — reconcile). `expiresAtTs` must be non-zero; `humanApprovalRef` must be set only after human approval. Create delegations through `DelegationClient` (or compatible) so FluxFlow's no-unbounded-expiry policy applies.
- **FluxLedger / FluxProof:** consume `SettlementReceipt`; key on `paymentId` / `signature`. Reconcile reserved-but-unconfirmed payments by signature. Contract/obligation IDs in receipts are off-chain identifiers — do not publish them on-chain unsalted (product rule: only salted commitments, authority state and settlement evidence go on-chain).
- **FluxShell:** map `FluxFlowErrorCode` to business language; use `createMockEnvironment()` for UI development (set `allowBrowserRuntime` only with mocks).
- **Security:** run the executor and agent signer server-side only; inject signers via your secret manager; never expose RPC provider tokens to browser code (config rejects credentials embedded in URLs; no `NEXT_PUBLIC_*` variables are read or defined).
- **Framework:** no framework assumptions; pure TypeScript ES modules (`NodeNext`).
