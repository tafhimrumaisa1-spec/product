# Submission brief

## FluxMandate

**The living financial authority system for autonomous companies.**

Companies increasingly let software agents buy compute, data and services, but commercial agreements are written for people while agents need explicit limits. FluxMandate turns contract language into evidence-backed obligation proposals, requires a human to approve material terms, simulates their impact on company cash, and translates approved intent into bounded machine authority.

The trust model is simple: **AI interprets. Humans approve. Deterministic code calculates. Solana enforces.** The model never receives treasury keys and cannot approve a mandate. Contract text remains private and off-chain; the registry is designed to hold commitments and authority state.

The current hackathon build includes live Groq extraction of a synthetic compute agreement, schema validation, a human checkpoint, deterministic FluxTwin projections, an Anchor registry compiled locally, mock-first FluxFlow execution, ledger/proof modules, Phantom connection and an explicitly labelled replay fallback. Devnet registry deployment and real transaction evidence remain final integration work and must not be claimed before verification.

## Differentiation

FluxMandate is not another wallet chatbot, payment rail or finance dashboard. Its product is the chain of authority:

```text
clause → reviewed obligation → company impact → bounded mandate → payment decision → reconciled proof
```

That chain lets a finance team answer not only *what moved*, but *which agreement allowed it, who approved it, what limit applied, and why the machine was allowed or refused*.

## Safety

The demo uses synthetic contract text and test assets only. No real funds or confidential agreements should be used.
