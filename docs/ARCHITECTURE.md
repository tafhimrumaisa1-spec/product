# FluxMandate architecture

## Product boundary

FluxMandate is the contract-to-authority layer between company systems and autonomous software. It does not replace accounting systems, banks, exchanges, or Solana payment primitives.

## Modules

- **FluxShell** — judge-first public experience and company command center.
- **FluxGraph** — shared economic entities and immutable events.
- **FluxContracts** — evidence-backed obligation proposals.
- **FluxTwin** — deterministic cash and runway simulation.
- **FluxMandate** — contract-linked authority registry.
- **FluxFlow** — delegated execution and payment routing.
- **FluxLedger** — reconciliation and agent economics.
- **FluxProof** — evidence and settlement trace.

## Trust split

| Plane | Responsibility |
| --- | --- |
| AI | Extract and explain proposed terms |
| Human | Review and approve material authority |
| Deterministic services | Validate, calculate, reconcile |
| Solana | Record authority and enforce payment constraints |

Contracts remain private. Only salted commitments, authority state, delegation references, and settlement evidence are suitable for public chain state.

