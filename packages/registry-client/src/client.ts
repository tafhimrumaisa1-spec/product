import { AnchorProvider, BN, Program, type Idl, type Wallet } from "@anchor-lang/core";
import { Connection, PublicKey, SystemProgram, type ConfirmOptions } from "@solana/web3.js";
import { FLUX_MANDATE_IDL, PROGRAM_ID } from "./idl.js";

export type Id32 = Uint8Array;
export type MandateStatus = "draft" | "active" | "paused" | "expired" | "revoked";

export interface RegistryClientConfig {
  connection: Connection;
  wallet: Wallet;
  cluster: "devnet";
  programId?: string;
  confirmOptions?: ConfirmOptions;
  /** Recording fake for tests. Never use to bypass the real program in production. */
  programOverride?: RegistryProgramPort;
}

export interface CommitContractInput {
  companyId: Id32; contractId: Id32; documentCommitment: Id32; termsCommitment: Id32; version: number;
}

export interface LinkMandateInput {
  companyId: Id32; contractId: Id32; mandateId: Id32; obligationId: Id32;
  agent: string; vendor: string; delegation: string; assetMint: string;
  periodCap: bigint; periodSeconds: bigint; startsAt: bigint; expiresAt: bigint;
}

export interface SetMandateStatusInput { companyId: Id32; mandateId: Id32; status: MandateStatus; }
export interface ExecutePaymentInput {
  companyId: Id32; mandateId: Id32; paymentId: Id32;
  sourceToken: string; vendorToken: string; assetMint: string; amount: bigint;
}
export interface RegistryReceipt { signature: string; explorerUrl: string; accounts: Record<string, string>; }

interface MethodBuilderPort {
  accountsStrict(accounts: Record<string, PublicKey>): MethodBuilderPort;
  rpc(): Promise<string>;
}

export interface RegistryProgramPort {
  methods: {
    initializeCompany(companyId: number[]): MethodBuilderPort;
    commitContract(contractId: number[], documentCommitment: number[], termsCommitment: number[], version: number): MethodBuilderPort;
    linkMandate(mandateId: number[], obligationId: number[], agent: PublicKey, vendor: PublicKey, delegation: PublicKey, assetMint: PublicKey, periodCap: BN, periodSeconds: BN, startsAt: BN, expiresAt: BN): MethodBuilderPort;
    setMandateStatus(status: Record<string, Record<string, never>>): MethodBuilderPort;
    executePayment(paymentId: number[], amount: BN): MethodBuilderPort;
  };
}

export interface RegistryClient {
  readonly authority: string;
  initializeCompany(companyId: Id32): Promise<RegistryReceipt>;
  commitContract(input: CommitContractInput): Promise<RegistryReceipt>;
  linkMandate(input: LinkMandateInput): Promise<RegistryReceipt>;
  setMandateStatus(input: SetMandateStatusInput): Promise<RegistryReceipt>;
  executePayment(input: ExecutePaymentInput): Promise<RegistryReceipt>;
}

export function createRegistryClient(config: RegistryClientConfig): RegistryClient {
  validateConfig(config);
  const authority = config.wallet.publicKey;
  if (!authority) throw new RegistryClientError("WALLET_NOT_CONNECTED", "A connected wallet is required.");
  const programId = new PublicKey(config.programId || PROGRAM_ID);
  const program = config.programOverride || createProgram(config, programId);

  return {
    authority: authority.toBase58(),
    async initializeCompany(companyId) {
      const id = requireId32(companyId, "companyId");
      const companyRegistry = deriveCompanyRegistry(authority, id, programId);
      const signature = await program.methods.initializeCompany(bytes(id)).accountsStrict({ authority, companyRegistry, systemProgram: SystemProgram.programId }).rpc();
      return receipt(signature, { companyRegistry });
    },
    async commitContract(input) {
      const companyId = requireId32(input.companyId, "companyId");
      const contractId = requireId32(input.contractId, "contractId");
      const documentCommitment = requireId32(input.documentCommitment, "documentCommitment");
      const termsCommitment = requireId32(input.termsCommitment, "termsCommitment");
      if (!Number.isInteger(input.version) || input.version < 1 || input.version > 0xffff_ffff) throw new RegistryClientError("INVALID_VERSION", "version must be a positive u32.");
      const companyRegistry = deriveCompanyRegistry(authority, companyId, programId);
      const contractCommitment = deriveContractCommitment(companyRegistry, contractId, programId);
      const signature = await program.methods.commitContract(bytes(contractId), bytes(documentCommitment), bytes(termsCommitment), input.version).accountsStrict({ authority, companyRegistry, contractCommitment, systemProgram: SystemProgram.programId }).rpc();
      return receipt(signature, { companyRegistry, contractCommitment });
    },
    async linkMandate(input) {
      const companyId = requireId32(input.companyId, "companyId");
      const contractId = requireId32(input.contractId, "contractId");
      const mandateId = requireId32(input.mandateId, "mandateId");
      const obligationId = requireId32(input.obligationId, "obligationId");
      requirePositiveU64(input.periodCap, "periodCap"); requirePositiveI64(input.periodSeconds, "periodSeconds"); requireI64(input.startsAt, "startsAt"); requireI64(input.expiresAt, "expiresAt");
      if (input.expiresAt <= input.startsAt) throw new RegistryClientError("INVALID_WINDOW", "expiresAt must be after startsAt.");
      const companyRegistry = deriveCompanyRegistry(authority, companyId, programId);
      const contractCommitment = deriveContractCommitment(companyRegistry, contractId, programId);
      const mandateLink = deriveMandateLink(companyRegistry, mandateId, programId);
      const signature = await program.methods.linkMandate(
        bytes(mandateId), bytes(obligationId), publicKey(input.agent, "agent"), publicKey(input.vendor, "vendor"),
        publicKey(input.delegation, "delegation"), publicKey(input.assetMint, "assetMint"),
        new BN(input.periodCap.toString()), new BN(input.periodSeconds.toString()), new BN(input.startsAt.toString()), new BN(input.expiresAt.toString()),
      ).accountsStrict({ authority, companyRegistry, contractCommitment, mandateLink, systemProgram: SystemProgram.programId }).rpc();
      return receipt(signature, { companyRegistry, contractCommitment, mandateLink });
    },
    async setMandateStatus(input) {
      const companyId = requireId32(input.companyId, "companyId");
      const mandateId = requireId32(input.mandateId, "mandateId");
      const companyRegistry = deriveCompanyRegistry(authority, companyId, programId);
      const mandateLink = deriveMandateLink(companyRegistry, mandateId, programId);
      const signature = await program.methods.setMandateStatus(statusArg(input.status)).accountsStrict({ authority, companyRegistry, mandateLink }).rpc();
      return receipt(signature, { companyRegistry, mandateLink });
    },
    async executePayment(input) {
      const companyId = requireId32(input.companyId, "companyId");
      const mandateId = requireId32(input.mandateId, "mandateId");
      const paymentId = requireId32(input.paymentId, "paymentId");
      requirePositiveU64(input.amount, "amount");
      const companyRegistry = deriveCompanyRegistry(authority, companyId, programId);
      const mandateLink = deriveMandateLink(companyRegistry, mandateId, programId);
      const paymentReceipt = derivePaymentReceipt(mandateLink, paymentId, programId);
      const sourceToken = publicKey(input.sourceToken, "sourceToken");
      const vendorToken = publicKey(input.vendorToken, "vendorToken");
      const assetMint = publicKey(input.assetMint, "assetMint");
      const signature = await program.methods.executePayment(bytes(paymentId), new BN(input.amount.toString())).accountsStrict({
        agent: authority, mandateLink, sourceToken, vendorToken, assetMint, paymentReceipt,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).rpc();
      return receipt(signature, { mandateLink, sourceToken, vendorToken, assetMint, paymentReceipt });
    },
  };
}

function createProgram(config: RegistryClientConfig, programId: PublicKey): RegistryProgramPort {
  if (programId.toBase58() !== PROGRAM_ID) throw new RegistryClientError("WRONG_PROGRAM", `Expected FluxMandate program ${PROGRAM_ID}.`);
  const provider = new AnchorProvider(config.connection, config.wallet, config.confirmOptions || { commitment: "confirmed", preflightCommitment: "confirmed" });
  return new Program(FLUX_MANDATE_IDL as Idl, provider) as unknown as RegistryProgramPort;
}

export function deriveCompanyRegistry(authority: PublicKey, companyId: Id32, programId = new PublicKey(PROGRAM_ID)): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("company"), authority.toBytes(), requireId32(companyId, "companyId")], programId)[0];
}
export function deriveContractCommitment(companyRegistry: PublicKey, contractId: Id32, programId = new PublicKey(PROGRAM_ID)): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("contract"), companyRegistry.toBytes(), requireId32(contractId, "contractId")], programId)[0];
}
export function deriveMandateLink(companyRegistry: PublicKey, mandateId: Id32, programId = new PublicKey(PROGRAM_ID)): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("mandate"), companyRegistry.toBytes(), requireId32(mandateId, "mandateId")], programId)[0];
}
export function derivePaymentReceipt(mandateLink: PublicKey, paymentId: Id32, programId = new PublicKey(PROGRAM_ID)): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("payment"), mandateLink.toBytes(), requireId32(paymentId, "paymentId")], programId)[0];
}

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export function id32FromHex(value: string): Id32 {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new RegistryClientError("INVALID_ID", "Expected exactly 64 hexadecimal characters.");
  return Uint8Array.from(value.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
}
export function explorerTransaction(signature: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new RegistryClientError("INVALID_SIGNATURE", "Invalid Solana transaction signature.");
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
export class RegistryClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RegistryClientError"; }
}

function receipt(signature: string, accounts: Record<string, PublicKey>): RegistryReceipt {
  return { signature, explorerUrl: explorerTransaction(signature), accounts: Object.fromEntries(Object.entries(accounts).map(([key, value]) => [key, value.toBase58()])) };
}
function validateConfig(config: RegistryClientConfig) {
  if (config.cluster !== "devnet") throw new RegistryClientError("WRONG_NETWORK", "FluxMandate hackathon transactions are Devnet-only.");
  if (!/^https:\/\//i.test(config.connection.rpcEndpoint)) throw new RegistryClientError("UNSAFE_RPC", "Devnet RPC must use HTTPS.");
  if ((config.programId || PROGRAM_ID) !== PROGRAM_ID) throw new RegistryClientError("WRONG_PROGRAM", `Expected FluxMandate program ${PROGRAM_ID}.`);
}
function requireId32(value: Id32, name: string): Id32 {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new RegistryClientError("INVALID_ID", `${name} must contain exactly 32 bytes.`);
  return value;
}
function bytes(value: Id32): number[] { return Array.from(value); }
function publicKey(value: string, name: string): PublicKey { try { return new PublicKey(value); } catch { throw new RegistryClientError("INVALID_ADDRESS", `${name} is not a valid Solana address.`); } }
function requirePositiveU64(value: bigint, name: string) { if (typeof value !== "bigint" || value <= 0n || value > 0xffff_ffff_ffff_ffffn) throw new RegistryClientError("INVALID_U64", `${name} must be a positive u64.`); }
function requireI64(value: bigint, name: string) { if (typeof value !== "bigint" || value < -0x8000_0000_0000_0000n || value > 0x7fff_ffff_ffff_ffffn) throw new RegistryClientError("INVALID_I64", `${name} must fit in i64.`); }
function requirePositiveI64(value: bigint, name: string) { requireI64(value, name); if (value <= 0n) throw new RegistryClientError("INVALID_I64", `${name} must be positive.`); }
function statusArg(status: MandateStatus): Record<string, Record<string, never>> {
  if (!["draft", "active", "paused", "expired", "revoked"].includes(status)) throw new RegistryClientError("INVALID_STATUS", "Unknown mandate status.");
  return { [status]: {} };
}
