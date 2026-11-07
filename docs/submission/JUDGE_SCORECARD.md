# Judge Scorecard

Scale: 1 (weak) – 5 (strong). Evidence column says what to look at. The "Honest limits" column states what the project does **not** claim, so scoring can be calibrated.

| Criterion | What to look for | 1–2 | 3 | 4–5 | Honest limits |
|---|---|---|---|---|---|
| **Novelty** | Is the clause → approved obligation → on-chain mandate → reconciled payment chain new, rather than a chatbot with a wallet? | Generic agent-payments demo | Known pieces combined sensibly | Clear new control model with explicit trust boundaries | Components (extraction, policy wallets) exist separately; novelty is the integrated chain |
| **Execution** | Does the golden demo work end to end? Are errors handled? Is the evidence trail coherent? Does replay verify? Do tests run? | Mocked or fragile | Works guided, partial live | All three modes work; tamper test fails correctly | Prototype; single synthetic contract; extraction accuracy unmeasured |
| **Solana necessity** | Is on-chain enforcement doing real work (rejecting over-limit payments independent of the agent)? Is private data kept off-chain? | Chain used only as a log | Enforcement partly on-chain | Limit check enforced on-chain; commitments recomputable | A database with signed logs could record the same data; the argument is about independent enforcement and verifiability |
| **AI necessity** | Does AI handle genuinely variable input (contract language)? Are its outputs gated and bounded? | Cosmetic AI | Useful extraction, weak gating | Clause-linked extraction, flagged uncertainty, human gate, no keys | Fixed templates might not need AI; benefit grows with contract variety |
| **Commercial value** | Is the problem real, the buyer clear, the scope credible, claims restrained? | Vague market | Plausible buyer, unvalidated | Specific beachhead, credible roadmap, honest risks | No market size asserted; no customers validated |

## Score sheet
| Criterion | Score (1–5) | Notes |
|---|---|---|
| Novelty | | |
| Execution | | |
| Solana necessity | | |
| AI necessity | | |
| Commercial value | | |
| **Total (/25)** | | |

## Quick claim-checks for judges
- [ ] I saw an over-limit payment rejected.
- [ ] I could not create a mandate without approving obligations.
- [ ] No secrets or signing keys were visible in the client.
- [ ] The proof drawer linked clause → approval → mandate → transaction.
- [ ] Anything labelled "live" or "verified" actually was.
