import type { Idl } from "@anchor-lang/core";

export const PROGRAM_ID = "E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq";

// Minimal client IDL. The complete generated IDL remains the source of truth
// for account decoding.
export const FLUX_MANDATE_IDL = {
  address: PROGRAM_ID,
  metadata: { name: "flux_mandate_registry", version: "0.1.0", spec: "0.1.0", description: "Contract-linked authority registry for FluxMandate" },
  instructions: [
    { name: "initialize_company", discriminator: [75,156,55,94,184,64,58,30], accounts: [
      { name: "authority", writable: true, signer: true }, { name: "company_registry", writable: true },
      { name: "system_program", address: "11111111111111111111111111111111" }
    ], args: [{ name: "company_id", type: { array: ["u8", 32] } }] },
    { name: "commit_contract", discriminator: [182,192,235,23,202,64,125,39], accounts: [
      { name: "authority", writable: true, signer: true }, { name: "company_registry", writable: true },
      { name: "contract_commitment", writable: true }, { name: "system_program", address: "11111111111111111111111111111111" }
    ], args: [
      { name: "contract_id", type: { array: ["u8", 32] } }, { name: "document_commitment", type: { array: ["u8", 32] } },
      { name: "terms_commitment", type: { array: ["u8", 32] } }, { name: "version", type: "u32" }
    ] },
    { name: "link_mandate", discriminator: [1,36,142,79,57,174,206,227], accounts: [
      { name: "authority", writable: true, signer: true }, { name: "company_registry", writable: true },
      { name: "contract_commitment" }, { name: "mandate_link", writable: true },
      { name: "system_program", address: "11111111111111111111111111111111" }
    ], args: [
      { name: "mandate_id", type: { array: ["u8", 32] } }, { name: "obligation_id", type: { array: ["u8", 32] } },
      { name: "agent", type: "pubkey" }, { name: "vendor", type: "pubkey" }, { name: "delegation", type: "pubkey" },
      { name: "asset_mint", type: "pubkey" }, { name: "period_cap", type: "u64" }, { name: "period_seconds", type: "i64" }, { name: "starts_at", type: "i64" },
      { name: "expires_at", type: "i64" }
    ] },
    { name: "set_mandate_status", discriminator: [119,9,167,49,222,249,195,26], accounts: [
      { name: "authority", signer: true }, { name: "company_registry" }, { name: "mandate_link", writable: true }
    ], args: [{ name: "status", type: { defined: { name: "MandateStatus" } } }] },
    { name: "execute_payment", discriminator: [86,4,7,7,120,139,232,139], accounts: [
      { name: "agent", writable: true, signer: true }, { name: "mandate_link", writable: true },
      { name: "source_token", writable: true }, { name: "vendor_token", writable: true },
      { name: "asset_mint" }, { name: "payment_receipt", writable: true },
      { name: "token_program", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { name: "system_program", address: "11111111111111111111111111111111" }
    ], args: [
      { name: "payment_id", type: { array: ["u8", 32] } }, { name: "amount", type: "u64" }
    ] }
  ],
  types: [{ name: "MandateStatus", type: { kind: "enum", variants: [
    { name: "Draft" }, { name: "Active" }, { name: "Paused" }, { name: "Expired" }, { name: "Revoked" }
  ] } }]
} as unknown as Idl;
