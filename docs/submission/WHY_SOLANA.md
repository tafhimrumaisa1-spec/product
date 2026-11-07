# Why Solana?

## The need
A spending limit is only a control if the party being limited cannot bypass it. If the limit lives in the same application the agent runs in, a bug or compromised agent can ignore it. We need an enforcement point that is independent of the agent, neutral between the company and the vendor, and inspectable by an auditor.

## What Solana provides here
1. **Independent enforcement.** Mandate state and the payment check live in an on-chain program/registry, so an over-limit payment fails regardless of agent behaviour **[Verify against FluxMandate implementation]**.
2. **Machine-speed, low-cost settlement.** Agents make many small payments; Solana's fees and confirmation times suit that pattern.
3. **Public verifiability.** Anyone given the contract terms and salt can recompute the commitment and compare it with on-chain state; settlements are checkable without trusting our database.
4. **Programmable stablecoin payments.** Payments can be made in a stable asset (Devnet test asset in this demo) with the mandate check coupled to settlement.

## What goes on-chain
Salted commitments, authority state and settlement evidence only. Contract text and clause data stay private.

## Honest trade-offs
- A conventional database with signed audit logs could record the same data; its weakness is that the operator controls it. On-chain enforcement removes that single point of control for the *limit check* specifically.
- On-chain systems add key-management, upgrade-authority and RPC-availability risks. The demo mitigates with Devnet-only funds and a verified replay fallback; production would need audit, key policy and monitoring.
- This prototype does not claim Solana is the only possible chain, only that the design needs an independent, public enforcement layer and Solana's cost and latency fit agent-scale payments.
