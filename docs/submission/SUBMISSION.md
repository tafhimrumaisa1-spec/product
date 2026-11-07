# Submission Description

FluxMandate is a financial authority system that lets autonomous software spend only within what a signed commercial contract allows.

Companies are starting to let AI agents buy compute, data and services, but contracts are documents and agents need machine-enforceable limits. FluxMandate bridges that gap. AI extracts vendor, amount, duration, periodic cap, payment schedule, renewal and termination terms from a contract. A human reviews and approves every material obligation. Deterministic code then simulates the effect on cash, burn and runway, and creates a contract-linked spending mandate registered on Solana. An agent makes an authorized payment; a payment exceeding the mandate is rejected on-chain. Each settlement is reconciled to the contract, obligation, mandate, agent and task, with an evidence trail.

AI interprets, humans approve, code calculates, Solana enforces. The AI never holds signing keys and cannot approve mandates. Contract documents stay private; only salted commitments, authority state and settlement evidence go on-chain.

The demo uses synthetic contracts and Devnet assets only, with no real money. Judges can test without a wallet, with Phantom on Devnet, or through verified replay.

FluxFlow also includes a tested x402 V2 bridge: an agent-facing payment challenge becomes a canonical spend request, then passes through the same contract-linked recipient, asset, cap, expiry, allowance and replay controls. Live facilitator settlement is intentionally outside the hackathon golden path.
