# Why AI?

## The task AI is actually needed for
Commercial agreements are unstructured and inconsistent. The same concept — a spending ceiling — appears as "not to exceed", "aggregate fees", "monthly commitment", or inside an order form that amends the master agreement. Renewal and termination terms are routinely buried in cross-references. A rules engine cannot read that variety without per-template engineering; a language model can propose a structured reading across them.

In FluxMandate the AI does two things:
1. **Extract and link.** Propose vendor, amount, duration, periodic cap, payment schedule, renewal and termination terms, each tied to a source clause and a confidence signal.
2. **Explain.** Describe in plain language what an obligation means and what the simulation shows.

## What AI is deliberately not allowed to do
- Approve an obligation or mandate.
- Hold or request signing keys.
- Compute balances, runway or cap arithmetic (deterministic code does this).
- Decide whether a payment is allowed (Solana-enforced mandate state does this).

## Why this split matters
Language models can be wrong while sounding confident. The design assumes that and contains the error: a wrong extraction has to survive human review of the source clause before it can become authority, and even then the enforcement logic is not the model.

## Would a non-AI approach work?
For a single known contract template, yes: a form or rules parser is cheaper and more predictable. AI earns its place when contracts vary — which is the realistic case for a company buying from many vendors. We state this plainly rather than claim AI is required for every case.

## Evaluating extraction quality
Judges can check: does each extracted field link to a clause; are ambiguous items flagged rather than silently resolved; can the reviewer edit; does an edit change downstream numbers deterministically. Accuracy on a broad real-contract corpus has **not** been measured in this prototype; see `faq.md`.
