# Post-Hackathon Roadmap

Status key: **Hackathon scope** = the nine-step golden demo. Everything else is **roadmap — not implemented**.

## Now — Hackathon scope
- One synthetic contract through extract → approve → simulate → mandate → pay → reject → reconcile → prove, on Devnet.
- Guided, Phantom Devnet and verified replay modes.

## 0–3 months — Harden
- Evaluate extraction on a labelled set of synthetic and consented real contracts; publish accuracy and failure modes.
- Independent security review of the on-chain program and key handling.
- Rejected-payment and revocation handling, expiry edge cases, test coverage expansion.
- Design-partner pilots using synthetic or sandbox data.

## 3–9 months — Broaden
- Multiple vendors and mandate portfolios; amendment and renewal handling.
- Multi-party approvals (e.g., finance + budget owner).
- Accounting and ERP export (read-only first).
- Role-based access, audit export formats.

## 9–18 months — Production readiness (conditional)
- Mainnet pilot only after audit, legal review and partner agreement.
- Custody integrations (the company keeps control of funds; FluxMandate does not take custody).
- Fiat on/off-ramp partnerships as needed.
- Compliance workstream per target jurisdiction.

## Exit criteria for each phase
Phase advances only if: tests pass in CI, security findings are resolved or accepted in writing, and at least one design partner confirms the workflow solves a real problem.
