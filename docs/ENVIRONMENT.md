# Environment

Local secrets belong in `apps/web/.env.local`, which Git ignores. Hosted secrets belong in Vercel project settings.

| Variable | Visibility | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | server | Selects `groq` or deterministic replay |
| `GROQ_API_KEY` | server secret | Authenticates live contract extraction |
| `GROQ_MODEL` | server | Selects the Groq model |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | public | Displays and validates the target cluster |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | public | Browser-safe Devnet RPC URL |
| `NEXT_PUBLIC_FLUX_REGISTRY_PROGRAM_ID` | public | Registry address after Devnet deployment |

Never store seed phrases, private keys, keypair JSON, contract documents or API secrets in public variables.
