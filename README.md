# FluxMandate

**The contract-to-authority layer for autonomous companies.**

[Live product](https://fluxmandate.vercel.app) · [The Thesis](https://fluxmandate.vercel.app/thesis) · [Solana program](https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet) · [Judge testing guide](docs/submission/JUDGE_TESTING.md)

FluxMandate converts private commercial agreements into evidence-backed obligations, deterministic company simulations and human-approved spending authority that is independently enforced on Solana.

> AI interprets. Humans approve. Deterministic systems calculate. Solana enforces.

## Why it exists

AI agents can already purchase compute, data and software. A wallet can prove who signed, and a payment protocol can move value, but neither proves that a payment was permitted by a contract, safe for the company's runway or explainable to finance later.

FluxMandate fills that missing layer:

`Contract → AI proposal → Human approval → FluxTwin → FluxMandate → Agent payment → FluxLedger → FluxProof`

## Verified hackathon build

| Capability | Evidence |
| --- | --- |
| Contract intelligence | Live server-side Groq extraction, strict schema validation and clause-linked proposals |
| Human control | Material obligations require explicit approval before becoming authority |
| Company Twin | Deterministic cash, commitment, runway and safe-to-deploy simulation |
| Multi-agent finance | Seven specialized agents share FluxGraph state and one bounded Mandate Kernel |
| Solana enforcement | Deployed Anchor program checks agent, recipient, asset, time window, cap and allowance |
| Authorized settlement | [1,260 synthetic units finalized on Devnet](https://explorer.solana.com/tx/eDFgXQ17fLKvgt8J33k5po3nVTXqYXGE1o6ajQmjF1RkZmZLhpRyiYS8e4aSDxYWTpyC15DPbhYUApMM8xoV9xQ?cluster=devnet) |
| Enforced rejection | [5,200-unit attempt rejected against a 4,000-unit cap](https://explorer.solana.com/tx/3sognxbcxsbcZbUhnwNKmcAoWeB2YQB97LP5yuRrRdHLoMkQL1LR6Fqo9drFPUrnkFgKGkqBpTRBZfuRPW17TwSR?cluster=devnet) with `6017 CapExceeded` |
| x402 V2 | Tested challenge-to-mandate bridge; live facilitator settlement remains the next adapter |
| Engineering | 416 passing tests, strict TypeScript and a production Next.js build |

The browser experience uses synthetic data and deterministic replay so judges can test safely without spending funds. The Proof stage links the separate recorded Devnet transactions.

## Why Solana is essential

Solana is not used as database decoration. The deployed program makes the authority check and token transfer one atomic boundary: an agent cannot bypass the approved vendor, asset, validity window, period cap, delegated allowance or replay protection.

- Program ID: `E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq`
- Network: Solana Devnet
- Upgrade transaction: [3PtEK…2aHc6](https://explorer.solana.com/tx/3PtEKndi9srUYSDqCmakLSU8md4PyvfQeXDgLmg3dBTkjM3DPhYUEE8LjYVCkPFEVdqy7yDJyspF1WQN2Lx2aHc6?cluster=devnet)
- Machine-readable run: [`packages/devnet-harness/evidence`](packages/devnet-harness/evidence)
- Full evidence notes: [`docs/DEVNET_EVIDENCE.md`](docs/DEVNET_EVIDENCE.md)

## Architecture

| Module | Responsibility |
| --- | --- |
| `FluxContracts` | Evidence-bound extraction and human-only obligation review |
| `FluxGraph` | Shared economic entities, lifecycle transitions and tamper-evident events |
| `FluxTwin` | Multi-scenario cash, runway, renewal and risk simulation |
| `FluxMandate` | Contract-linked authority registry and bounded payment program |
| `FluxFlow` | Direct and x402 spend requests, validation and settlement verification |
| `FluxLedger` | Reconciliation and machine-service accounting |
| `FluxProof` | Contract-to-settlement explanation and public evidence |

Private contract text and clause evidence remain off-chain. Only commitments, authority state and settlement evidence belong on the public ledger.

## Repository map

- `apps/web` — public product, Thesis page and guided demo
- `packages/contracts` — extraction, review and salted commitments
- `packages/graph` — validated economic graph and lifecycle machines
- `packages/twin` — deterministic multi-scenario Company Twin
- `packages/flow` — payment execution, x402 bridge and safety controls
- `packages/ledger-proof` — reconciliation and proof generation
- `packages/devnet-harness` — reproducible Devnet golden path
- `programs/flux-mandate-registry` — deployed Anchor program
- `docs/submission` — demo script, judge guide, FAQ, roadmap and submission copy

## Run locally

Requirements: Node.js 24+, npm and—only for Anchor development—Rust, Solana/Agave 4.1.2 and Anchor 1.2.2.

```bash
git clone https://github.com/tafhimrumaisa1-spec/product.git
cd product
npm ci
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

Open `http://localhost:3000`. Replay mode works without an AI key. For Live AI, set a server-only `GROQ_API_KEY` in `apps/web/.env.local`; never use a `NEXT_PUBLIC_` prefix for secrets.

## Verify

```bash
npm run verify
npm run build
```

To reproduce the synthetic Devnet golden path with a funded disposable Devnet signer:

```bash
npm run devnet:golden-path
```

Never use a personal or mainnet wallet. This hackathon build uses synthetic agreements and Devnet/local assets only.

## Track

FluxMandate is a **DefAI** project: AI interprets financial meaning while deterministic policy and Solana enforce the resulting authority. It is not an AI trading bot, custodial wallet or replacement for legal and accounting review.

## License

Licensed under the [Apache License 2.0](LICENSE).
