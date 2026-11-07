# Demo pipeline integration

This server-only adapter makes the reviewed FluxFlow and FluxLedger/FluxProof
packages available to the public guided demo without creating custody or
pretending a fixture is a live transaction.

## Endpoints

- `POST /api/demo/payment` with `{ "scenario": "authorized" }`
- `POST /api/demo/payment` with `{ "scenario": "over_cap" }`
- `GET /api/demo/proof?scenario=success`
- `GET /api/demo/proof?scenario=over_limit`

Each call starts from a fresh deterministic fixture. Responses explicitly say
`onchain: false` and use either `deterministic_mock` or
`deterministic_replay`. Synthetic signatures never link to Solana Explorer.

The real Devnet path must use the deployed registry and verified transaction
evidence. Do not relabel these endpoints as live settlement.
