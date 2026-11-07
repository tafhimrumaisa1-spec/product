# RESEARCH.md — Agent 06 / FluxFlow

Access date for every entry: **2026-11-07**.
Rule applied: technical claims rely only on solana.com, anchor-lang.com, official package docs, and GitHub repositories maintained by the relevant project. Anchor is not used by FluxFlow (no program is authored here), so no anchor-lang.com page was needed.

"Fetched" = page content retrieved and read. "Snippet" = seen only as a search-result excerpt of that official page (weaker evidence; flagged where a decision depends on it).

## A. Primary sources used

| # | Page title | Direct URL | Evidence | Decision it supports |
|---|---|---|---|---|
| 1 | Subscriptions — Overview | https://solana.com/docs/payments/subscriptions/overview | Fetched | Use the Solana Foundation **Subscriptions** program (ID `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) as the on-chain enforcement layer; three models exist (fixed, recurring, plan); FluxFlow implements fixed + recurring only (plans are out of scope). Audited by Cantina per the page. |
| 2 | Fixed Delegation | https://solana.com/docs/payments/subscriptions/fixed-delegation | Fetched | Builder names `initSubscriptionAuthority`, `createFixedDelegation({tokenMint, delegatee, nonce, amount, expiryTs})`, `transferFixed({delegatee, delegator, delegatorAta, tokenMint, delegationPda, amount, receiverAta, tokenProgram})`, `revokeDelegation({authority, delegationAccount})`; PDA helpers `findSubscriptionAuthorityPda`, `findFixedDelegationPda`; `fetchMaybeSubscriptionAuthority(rpc, pda)`; amounts in base units, `expiryTs` in Unix seconds, `0` = no expiry; delegatee signs transfers, delegator signs create/revoke. |
| 3 | Recurring Delegation | https://solana.com/docs/payments/subscriptions/recurring-delegation | Fetched | `createRecurringDelegation({tokenMint, delegatee, nonce, amountPerPeriod, periodLengthS, startTs, expiryTs})`, `transferRecurring`, `findRecurringDelegationPda`; `startTs = 0` starts on landing and then `expiryTs` must be non-zero; transfers over the period's remaining allowance are rejected; transfers after `expiryTs` fail; revoke closes the PDA and returns rent. Client composition: `createClient().use(signer(s)).use(solanaLocalRpc({rpcUrl:'http://127.0.0.1:8899'})).use(subscriptionsProgram())`. |
| 4 | Create Subscription Authority | https://solana.com/docs/payments/subscriptions/create-subscription-authority | Fetched | One Subscription Authority per (user, mint); the user's token account must already exist; user signs init; do not close the authority while delegations depend on it. Supports FluxFlow's "init authority if missing" step and the documented precondition. |
| 5 | solana-foundation/subscriptions (README) | https://github.com/solana-foundation/subscriptions | Fetched | `@solana/subscriptions` is a Kit plugin (`subscriptionsProgram()`) with overlay builders; account fetchers `fetchDelegationsByDelegator` / `fetchDelegationsByDelegatee`; PDA helper list; local testing uses Surfpool + vitest (`just test-client`) — used to decide FluxFlow's tests do NOT depend on a validator and to document how to add one. |
| 6 | Program architecture (ADR-001) | https://github.com/solana-foundation/subscriptions/blob/main/docs/001-program-architecture.md | Fetched | Account layouts: FixedDelegation `{amount (remaining pullable), expiry_ts, …}`; RecurringDelegation `{current_period_start_ts, period_length_s, expiry_ts, amount_per_period, amount_pulled_in_period, …}`; `expiry_ts == 0` = no expiry. Drives `DelegationState` and the pure `computeRemaining()` function. The page names only one error (`StaleSubscriptionAuthority`), so FluxFlow does not pattern-match program errors. |
| 7 | x402 on Solana (V2) | https://solana.com/docs/payments/agentic-payments/x402 | Fetched | V2 only: CAIP-2 networks (Devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, Mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`), V2 headers `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` (V1 `X-PAYMENT` must not be used), packages `@x402/core @x402/express @x402/fetch @x402/svm`, Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, client spend policy example, and the Solana `exact` verification checklist (instruction layout, amount, mint, recipient ATA, authority, unexpired, not replayed, settled at required confirmation). Basis for `examples/x402-v2-sandbox.ts` and for the executor/verifier checks. |
| 8 | x402 specification v2 | https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md | Snippet only | Confirms CAIP-2 `namespace:reference` network format and that Solana `exact` uses `TransferChecked`. Not relied on beyond what source #7 states. |
| 9 | Machine Payments Protocol on Solana | https://solana.com/docs/payments/agentic-payments/mpp (fetched via the `/uk/` locale URL) | Fetched | MPP intents `charge` and `session`; session = on-chain payment channel with a maximum deposit + cumulative signed vouchers; HTTP 402 `WWW-Authenticate: Payment`, `Authorization: Payment`, `Payment-Receipt`; Internet-Draft status ("details may change"); replay: signature reuse check and consume must be **atomic across instances**, sessions need shared persisted state. Basis for the roadmap-only `MppSessionAdapter` and for `ReceiptStore`'s atomic `reserve` / `markSubmitted` contract. |
| 10 | solana-foundation/payment-channels | https://github.com/solana-foundation/payment-channels | Snippet only | Channel program backs MPP session and x402 `upto`; escrowed spending ceiling + signed vouchers. Roadmap reference only. |
| 11 | Transaction Confirmation & Expiration | https://solana.com/docs/core/transactions/confirmation | Fetched | Blockhash valid ~151 blocks (~60–90 s); record `lastValidBlockHeight`; detect expiry by polling `getBlockHeight` (`confirmed`) and comparing; prefer `confirmed` commitment; resend/retry guidance. Implemented in `confirmTransaction()`: expired + no status => `BLOCKHASH_EXPIRED` (safe to retry); deadline with no answer => `RPC_TIMEOUT` (outcome unknown, key stays reserved). The page has no Kit-specific helper, so none is assumed. |
| 12 | anza-xyz/kit (README) | https://github.com/anza-xyz/kit | Fetched | `@solana/kit` replaces the class-based web3.js 1.x API (`Connection`, `PublicKey`, `Keypair`, `Transaction`); RPC pattern `rpc.<method>(...).send({ abortSignal })`; `address()`, `lamports()`; commitment passed as option. Decision: no legacy web3.js anywhere; chain reader uses the `.send({abortSignal})` pattern with `AbortSignal.timeout`. |
| 13 | JavaScript/TypeScript SDK for Solana | https://solana.com/docs/clients/official/javascript | Snippet | Kit is the recommended SDK; web3.js v3 is a Kit-based compatibility option. Decision: depend on Kit, not web3.js. |
| 14 | Spend permissions | https://solana.com/docs/payments/advanced-payments/spend-permissions | Snippet | Spend permissions are the SPL Token approve/revoke delegate model (non-custodial). Decision: raw SPL `Approve` is not used directly (one delegate per token account); the Subscriptions program is the multi-limit layer. |
| 15 | Interacting with Solana | https://solana.com/docs/payments/interacting-with-solana | Snippet | Devnet endpoint `https://api.devnet.solana.com`; devnet is for development. Default `devnetConfig().rpcUrl`. |
| 16 | Developer tools (payments) | https://solana.com/docs/payments/developer-tools | Snippet | Official Kit-ecosystem package list (`@solana/kit-plugin-rpc`, `@solana/kit-plugin-signer`, `@solana-program/token`), Solana Faucet. |
| 17 | Local validator / Surfpool guide | https://solana.com/developers/guides/getstarted/solana-test-validator | Snippet | `surfpool start` is the documented local validator for testing; local default endpoint `http://127.0.0.1:8899`. |
| 18 | Solana Now Has Native Subscriptions & Allowances | https://solana.com/news/subscriptions-and-allowances | Snippet | Release context (Solana Foundation announcement, 2026). Context only. |

## B. Seen but NOT relied on (non-primary)

Third-party pages surfaced by search (Chainstack docs, DeepWiki, Solana Tracker, devrels.xyz, Yahoo/CoinMarketCap news, x402-rs, `x402-solana` on npm, community MPP SDK forks). They were used only to find leads. Specifically, these claims appear **only** in non-primary sources and are therefore **not** treated as facts in the code or docs: (a) the Subscription Authority holds a `u64::MAX` SPL approval; (b) "skipped periods don't stack"; (c) `@solana/kit` 8.x / Node ≥ 20.18; (d) the `@solana/mpp` package. The primary MPP page names `@solana/pay-kit`, not `@solana/mpp`.

## C. Items from the research brief — status

| Brief item | Status |
|---|---|
| @solana/kit | Researched (#12, #13). **Installed version not verified**: npmjs.com and the Kit releases page were not fetchable (not on the session allow-list); x402 pages show `@solana/kit@^6.9.0` in their examples. Peer range is therefore `*`. |
| @solana/subscriptions | Researched (#1–#6). Package version / peer range **not verified** (npm unreachable). |
| Fixed / recurring delegation | Researched and implemented (#2, #3, #6). |
| Spend permissions | Researched (#14). |
| Transaction confirmation | Researched and implemented (#11). |
| x402 V2 | Researched (#7, #8); sandbox example written but **not run**. |
| MPP sessions / payment channels | Researched (#9, #10); interface-only. |
| Devnet and local testing | Researched (#5, #15, #17). No validator or network is available in this build environment, so no on-chain test was run. |
| Payment verification and replay prevention | Researched (#7, #9); implemented as `ReceiptStore` + `SettlementVerifier` + executor ordering. |

## D. Implementation decisions traced to research

1. **Enforcement stays on-chain.** The executor's checks are pre-flight guards; the Subscriptions program is the enforcement point. (#1, #3, #6)
2. **Mandatory expiry.** FluxFlow refuses to *create* delegations with `expiryTs == 0` even though the program permits it. This is a FluxFlow policy (bounded machine authority), not a program requirement. (#2, #6)
3. **Two signers, two clients.** Create/revoke use the delegator's signer; pulls use the delegatee's signer (documented in #2/#3). The agent client never receives the delegator signer.
4. **Network identity is CAIP-2 only**, Devnet or `local`. Mainnet is not representable in `NetworkId`; the Kit chain reader additionally throws if the RPC's genesis hash matches the Mainnet reference. (#7)
5. **Confirmation semantics** follow #11 exactly; a timeout never releases the idempotency key because the transaction may have landed.
6. **Replay control** follows the "atomic reuse check + consume" requirement (#9) and the x402 checklist (#7): unique `paymentId`, unique signature, commit only after on-chain evidence matches.
7. **Evidence-based verification.** Settlement is verified from token-balance deltas of the confirmed transaction (mint, recipient, exact amount, payer debit), not from the agent's claim.
8. **x402 stays off the critical path.** Example only; V2 identifiers and library-produced headers only (#7).

## E. Second research / API-compatibility review (before packaging)

- Re-fetched Subscriptions overview and Create-Subscription-Authority pages: no deprecation notice or warning found; audit status (Cantina) stated. The "u64::MAX" detail was **not** confirmed by the primary page and is excluded.
- Re-checked every builder/PDA/fetch name used in `adapters/subscriptions.ts` against pages #2, #3, #4, #5; the adapter test asserts the exact argument-name sets.
- Searched the whole delivery tree for V1 x402 headers (`X-PAYMENT`), V1 network names (`solana-devnet`, `solana-mainnet`), legacy `@solana/web3.js` / `@solana/spl-token` imports, `NEXT_PUBLIC`, PEM keys and 32-byte key arrays: none present (automated in `tests/adapter-and-hygiene.test.ts`, plus a manual grep).
- Could not re-verify: package versions (npm blocked), the real return value of `sendTransaction()`, a single-delegation account fetch helper, Kit-specific confirmation helpers. These are recorded in `ASSUMPTIONS.md` and isolated behind injected ports.
