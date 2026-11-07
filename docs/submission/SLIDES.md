# Six-Slide Presentation Outline

Format: 16:9, dark stone background, off-white text, one lime accent, thin-border panels, no gradients. One idea per slide. Target 3 minutes talk time + 1 minute live demo cut-in, or 5 minutes without cut-in.

## Slide 1 — Problem
**Title:** Agents can spend. Finance can't say how much.
**On slide:** Three-column panel — *Contract* ("up to X per month") · *Finance system* (records after the fact) · *Agent* (needs a limit now). Gap highlighted between Contract and Agent.
**Say:** AI agents increasingly buy compute, data and services. The commercial terms live in PDFs; the accounting lives in ledgers; the agent needs a machine-readable limit at the moment of payment. Today that gap is filled by a shared card or by manual approval of every invoice.
**Avoid:** Statistics we cannot source.

## Slide 2 — Insight
**Title:** The contract is the authority. Make it executable, safely.
**On slide:** Four-cell panel — AI interprets · Humans approve · Code calculates · Solana enforces.
**Say:** The insight is separation of roles. AI is good at reading messy documents but must not be trusted with money. So AI proposes, a human approves, deterministic code does the arithmetic, and Solana enforces the limit independent of the agent.

## Slide 3 — Product
**Title:** FluxMandate: from signed contract to enforceable mandate
**On slide:** Horizontal flow of the eight modules grouped as Understand (FluxContracts, FluxGraph) → Decide (FluxTwin, human approval) → Authorize (FluxMandate) → Execute (FluxFlow) → Prove (FluxLedger, FluxProof). FluxShell as the surrounding frame.
**Say:** Walk the flow in one sentence per group. Emphasize that the human approval gate sits before any authority exists.

## Slide 4 — Working demonstration
**Title:** Live: one payment accepted, one rejected
**On slide:** Screenshot strip: extraction → approval → runway → mandate → accepted payment → rejected payment → proof drawer. QR/link to the demo (no sign-in).
**Say:** Cut to the live demo (or recorded guided run). State which mode is being shown. Show the rejection explicitly — it is the key proof.

## Slide 5 — Why AI + Solana
**Title:** Each is used where it is necessary
**On slide:** Two columns.
- *AI is needed* to turn heterogeneous contract language into structured, clause-linked obligations and to explain impacts in plain language.
- *Solana is needed* so spending limits are enforced by a shared, neutral registry that the agent cannot bypass, with fast low-fee settlement and public verifiability.
- Footer line: "AI never signs. Solana never reads contracts."
**Say:** Be explicit about what each component does not do.

## Slide 6 — Market, roadmap and ask
**Title:** Start with one workflow; expand carefully
**On slide:** Left: beachhead (agent-purchased compute/data/API services under vendor contracts) and expansion path. Middle: roadmap (Now / Next / Later). Right: the ask.
**Ask (select what applies):**
1. Design partners: finance or ops teams running AI agents who will test with synthetic data first.
2. Feedback from auditors and controllers on the evidence trail.
3. Introductions to Solana ecosystem payment, stablecoin and custody providers.
4. A security review before any mainnet pilot.
**Say:** We are not claiming to replace ERPs, banks or treasury systems. We add a missing control layer between them and autonomous software.
