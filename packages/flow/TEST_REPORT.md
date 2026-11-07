# TEST_REPORT.md

## What was actually run

Environment: Node v22.23.4, `tsc` 7.0.2, `tsx` (Node's built-in `node:test` runner). No network for package installs; no Solana validator, no Devnet access.

| Command (from `source/`) | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, covers `src/` and `../tests/`) | **0 errors** |
| `tsx --test ../tests/*.test.ts` | **50 tests, 13 suites: 50 pass, 0 fail, 0 skipped** |
| Manual grep of `source/` and `tests/` for `NEXT_PUBLIC`, `X-PAYMENT`, `web3.js`, PEM headers | no matches outside the guard test itself |

## Coverage by requirement

| Requirement | Test(s) |
|---|---|
| Local and Devnet configuration | `config`: CAIP-2 devnet id, https-only devnet, explicit local allow-list, credentials-in-URL rejected, bad timeouts, mainnet / V1-style names refused |
| Fixed + recurring delegation creation | mock client tests; adapter test asserts documented builder names and exact argument-name sets |
| Remaining-allowance queries | pure `computeRemaining` (fixed, recurring, reset at period boundary, not started, expired, revoked); adapter reader mapping |
| Delegation revocation | mock revoke + executor `DELEGATION_REVOKED`; adapter passes delegator signer + PDA |
| Controlled SPL transfer | executor golden path; adapter `transferFixed` / `transferRecurring` with delegatee signer and receiver ATA |
| Transaction confirmation | finalized path; RPC outage until deadline; dropped tx → `BLOCKHASH_EXPIRED`; dropped tx within deadline → `RPC_TIMEOUT` |
| SettlementReceipt construction | all linkage fields (contract, obligation, mandate, agent, task, approval ref); JSON-safe; no secret-like fields |
| Network / mint / recipient / amount validation | `WRONG_NETWORK` (request and RPC-reported), `WRONG_MINT`, `WRONG_RECIPIENT`, `INVALID_AMOUNT`, per-payment `CAP_EXCEEDED`, cumulative `CAP_EXCEEDED` |
| Insufficient balance | `INSUFFICIENT_BALANCE`, nothing sent, key not burned |
| Expiration | mandate expiry; delegation expiry |
| Duplicate-receipt prevention | repeated paymentId; concurrent duplicates (exactly one succeeds, one transaction sent); reused signature under new paymentId; `ReceiptStore` state machine |
| RPC timeout semantics | pre-send outage releases key; post-send timeout keeps key reserved |
| Settlement verification | accepts matching evidence; flags wrong recipient/amount/mint/network, missing evidence, failed tx; mismatch after confirmation keeps key reserved |
| Mock adapters | environment seeds a funded, approved demo mandate; program-level refusal simulated even if pre-flight is bypassed |
| Secrets / browser | browser-runtime construction refused; static scans for secrets, key arrays, `process.env`, key generation in `src/` |
| x402 V1 / legacy SDK avoidance | static scan for V1 headers, V1 network names, web3.js / spl-token imports |
| MPP roadmap | every method throws `NOT_IMPLEMENTED` |

## NOT tested (and why)

1. **Anything on-chain.** No validator (Surfpool/solana-test-validator), no Devnet, no program deployment. The mock simulates *behaviour* of the Subscriptions program; it is not evidence the real program behaves identically.
2. **Real `@solana/kit` / `@solana/subscriptions` integration.** Packages could not be installed (no network). `adapters/subscriptions.ts` is tested against a recording fake that mirrors the documented API; `adapters/kit-chain-reader.ts` has **no test** and was not compiled against real Kit types.
3. **`examples/x402-v2-sandbox.ts`.** Not compiled (outside tsconfig), not run: needs `@x402/*` packages, a V2 facilitator, funded Devnet accounts.
4. **Real RPC timeout/abort behaviour** (`AbortSignal.timeout` with Kit's `.send`) — only simulated through the mock.
5. **Concurrency against a durable store** — only the in-memory store was tested.
6. **Token-2022 transfer-fee/hook mints** and **sponsor/fee-payer flows**.
7. **Browser-runtime guard** was tested by defining `globalThis.window`; not tested in a real browser bundle.

## How to extend to on-chain tests

Follow the subscriptions repo's approach (README, `just test-client`): start Surfpool, install the program at `De1eg…`, create a mint and funded accounts, build clients per `RESEARCH.md` #3, and run the executor with `createSubscriptionsDelegationClient` + `createKitChainReader`.
