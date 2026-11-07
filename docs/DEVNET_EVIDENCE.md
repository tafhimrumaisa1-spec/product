# Devnet evidence

## Registry deployment

- Cluster: Solana Devnet
- Program ID: `E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq`
- Executable account: verified through Devnet RPC
- Loader owner: `BPFLoaderUpgradeab1e11111111111111111111111`
- Deployment transaction: `4TsPp7B8yPKhWq8NW768Cuvd88r2xdwi9XX5JthoHazoW8hpjhJhiWbnZxhKHE5QAanWn8FJ6BAj6VLjsk4TRfpA`
- Confirmation: finalized, no transaction error

## Bounded-payment upgrade

- Upgrade transaction: `3PtEKndi9srUYSDqCmakLSU8md4PyvfQeXDgLmg3dBTkjM3DPhYUEE8LjYVCkPFEVdqy7yDJyspF1WQN2Lx2aHc6`
- Deployed slot: `519737941`
- ProgramData allocation after upgrade: `231080` bytes
- Local executable SHA-256: `b71e438e1eeb390927c4783d966bf3edef4482308c3a7ccff7dc1f2da1547bc2`
- Upgrade authority preserved: `65UpuUWvd21qmRxLJKnbHKfkacRR38Nz9SA1QBFgvDpQ`
- Rust policy tests: 5 passed, 0 failed

Upgrade transaction:
https://explorer.solana.com/tx/3PtEKndi9srUYSDqCmakLSU8md4PyvfQeXDgLmg3dBTkjM3DPhYUEE8LjYVCkPFEVdqy7yDJyspF1WQN2Lx2aHc6?cluster=devnet

Program Explorer:
https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet

Deployment transaction:
https://explorer.solana.com/tx/4TsPp7B8yPKhWq8NW768Cuvd88r2xdwi9XX5JthoHazoW8hpjhJhiWbnZxhKHE5QAanWn8FJ6BAj6VLjsk4TRfpA?cluster=devnet

## Golden-path enforcement evidence

- Run: `9f606857-f1eb-4f1f-877b-df3f15eb6018`
- Synthetic mint: `6ndL9DEqQayYr1KDSHSVwZW93DyxsjWgA4gXijuaqch3`
- Company registry: `8ioBRzGG6AKQfhTA3YvXgBCXzGgmy6rSPiuz31hd3rVY`
- Mandate: `BcAmTR6svDVZ7eAbkEhTcoDH64CA2NEw217Zn2XsJm4F`
- Payment receipt: `8grX7vqEwnWnRW1dP7p6vLiKasoKEXMnbfRAkmfcjzPX`
- Mandate cap: `4,000` synthetic tokens per 30-day period
- Independent SPL delegate allowance: `10,000` synthetic tokens
- Authorized payment: `1,260` synthetic tokens; finalized in slot `519741564`
- Over-cap attempt: `5,200` synthetic tokens; failed in slot `519741574` with `6017 CapExceeded`

Authorized payment:
https://explorer.solana.com/tx/eDFgXQ17fLKvgt8J33k5po3nVTXqYXGE1o6ajQmjF1RkZmZLhpRyiYS8e4aSDxYWTpyC15DPbhYUApMM8xoV9xQ?cluster=devnet

Rejected attempt:
https://explorer.solana.com/tx/3sognxbcxsbcZbUhnwNKmcAoWeB2YQB97LP5yuRrRdHLoMkQL1LR6Fqo9drFPUrnkFgKGkqBpTRBZfuRPW17TwSR?cluster=devnet

The complete machine-readable record is checked in at
`packages/devnet-harness/evidence/devnet-golden-path-9f606857-f1eb-4f1f-877b-df3f15eb6018.json`.

## Remaining product integration

- Let a connected browser wallet create its own company, contract and mandate
  accounts from the guided interface rather than the repeatable CLI harness.
- Replace deterministic interactive payment replay with an explicitly confirmed
  wallet-submitted Devnet run when a judge opts into spending Devnet SOL.
