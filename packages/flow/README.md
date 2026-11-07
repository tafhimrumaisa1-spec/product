# FluxFlow — execution and payment routing

FluxFlow is the module of FluxMandate that turns an approved, contract-linked mandate into a **controlled, verifiable token payment** by an autonomous agent.

> AI interprets and explains. Humans approve. Deterministic code calculates. **Solana enforces.**
> FluxFlow is the deterministic code between an approved mandate and the Solana program. It never approves anything and never holds treasury keys.

**Scope:** Devnet and local only. Synthetic data. No real money. Mainnet is not representable in the type system.

## Implemented vs roadmap

| Implemented (tested against mocks) | Implemented (NOT tested against real SDKs/chain) | Roadmap / example only |
|---|---|---|
| Config (local, Devnet), validation, remaining-allowance maths, receipt store, confirmation, settlement verifier, payment executor, mock environment | `@solana/subscriptions` adapter, Kit chain reader | x402 V2 sandbox example (not run); MPP sessions / payment channels (interface only) |

## Layout

```
src/               interfaces, executor, adapters, mocks, roadmap stubs
examples/          x402 V2 sandbox (outside tsconfig, not on critical path)
tests/             node:test suites (50 tests)
RESEARCH.md        every source used, with decisions and access dates
HANDOFF.md         interfaces, integration requirements, limitations
ASSUMPTIONS.md  TEST_REPORT.md  FILES_CHANGED.md
```

## Quick start

```bash
npm run typecheck     # tsc --noEmit (strict)
npm test              # tsx --test tests/*.test.ts
```

Requires `typescript` and `tsx` on the path. No Solana packages are needed to compile or test; they are optional peer dependencies used only by the real adapters.

UI development without a chain:

```ts
import { createMockEnvironment, seedMockDemo } from '@fluxmandate/flow';
const env = createMockEnvironment();
const demo = await seedMockDemo(env);   // funded treasury, fixed delegation, approved mandate
```

See `HANDOFF.md` for the full interface list and wiring of the real adapters.
