import assert from "node:assert/strict";
import test from "node:test";
import { Connection, PublicKey } from "@solana/web3.js";
import { createRegistryClient, deriveCompanyRegistry, deriveContractCommitment, deriveMandateLink, derivePaymentReceipt, id32FromHex, PROGRAM_ID, RegistryClientError, TOKEN_PROGRAM_ID, type RegistryProgramPort } from "../src/index.js";

const authority = new PublicKey("CMgP3ZC8JEn7iKJK7yPwtHxjSmtkymjv1XH4dK5PafnE");
const id = (byte: number) => new Uint8Array(32).fill(byte);
const signature = "4TsPp7B8yPKhWq8NW768Cuvd88r2xdwi9XX5JthoHazoW8hpjhJhiWbnZxhKHE5QAanWn8FJ6BAj6VLjsk4TRfpA";

class RecordingBuilder {
  accounts?: Record<string, PublicKey>;
  accountsStrict(value: Record<string, PublicKey>) { this.accounts = value; return this; }
  async rpc() { return signature; }
}

function recordingProgram() {
  const calls: Array<{ name: string; args: unknown[]; builder: RecordingBuilder }> = [];
  const method = (name: string) => (...args: unknown[]) => { const builder = new RecordingBuilder(); calls.push({ name, args, builder }); return builder; };
  const program = { methods: {
    initializeCompany: method("initializeCompany"), commitContract: method("commitContract"),
    linkMandate: method("linkMandate"), setMandateStatus: method("setMandateStatus"), executePayment: method("executePayment"),
  }} as unknown as RegistryProgramPort;
  return { calls, program };
}

function client(program: RegistryProgramPort) {
  return createRegistryClient({
    connection: new Connection("https://api.devnet.solana.com", "confirmed"), cluster: "devnet", programOverride: program,
    wallet: { publicKey: authority, async signTransaction(tx: never) { return tx; }, async signAllTransactions(txs: never[]) { return txs; } } as never,
  });
}

test("PDA derivation is deterministic and separates namespaces", () => {
  const company = deriveCompanyRegistry(authority, id(1));
  const contract = deriveContractCommitment(company, id(2));
  const mandate = deriveMandateLink(company, id(3));
  assert.equal(company.toBase58(), "B7J73cDx3RKW3RvLZRrYxL1S86EJ3iGNS5JEKQaTT3Sn");
  assert.notEqual(contract.toBase58(), mandate.toBase58());
  assert.equal(new PublicKey(PROGRAM_ID).toBase58(), PROGRAM_ID);
});

test("initialize constructs only expected signer and PDA accounts", async () => {
  const fake = recordingProgram();
  const receipt = await client(fake.program).initializeCompany(id(1));
  assert.equal(fake.calls[0]?.name, "initializeCompany");
  assert.deepEqual(fake.calls[0]?.args, [Array.from(id(1))]);
  assert.equal(fake.calls[0]?.builder.accounts?.authority.toBase58(), authority.toBase58());
  assert.equal(receipt.signature, signature);
  assert.match(receipt.explorerUrl, /cluster=devnet$/);
});

test("commit and link derive registry accounts and preserve bigint values", async () => {
  const fake = recordingProgram(); const c = client(fake.program);
  await c.commitContract({ companyId: id(1), contractId: id(2), documentCommitment: id(4), termsCommitment: id(5), version: 1 });
  await c.linkMandate({
    companyId: id(1), contractId: id(2), mandateId: id(3), obligationId: id(6), agent: authority.toBase58(), vendor: authority.toBase58(),
    delegation: authority.toBase58(), assetMint: authority.toBase58(), periodCap: 4_000_000_000n, periodSeconds: 2_592_000n, startsAt: 1_800_000_000n, expiresAt: 1_900_000_000n,
  });
  assert.equal(fake.calls[0]?.name, "commitContract"); assert.equal(fake.calls[1]?.name, "linkMandate");
  assert.equal((fake.calls[1]?.args[6] as { toString(): string }).toString(), "4000000000");
  assert.equal((fake.calls[1]?.args[7] as { toString(): string }).toString(), "2592000");
  assert.ok(fake.calls[1]?.builder.accounts?.mandateLink);
});

test("execute derives a replay-protected receipt and pins the classic token program", async () => {
  const fake = recordingProgram();
  await client(fake.program).executePayment({
    companyId: id(1), mandateId: id(3), paymentId: id(9), sourceToken: authority.toBase58(),
    vendorToken: authority.toBase58(), assetMint: authority.toBase58(), amount: 1_000_000n,
  });
  assert.equal(fake.calls[0]?.name, "executePayment");
  assert.equal((fake.calls[0]?.args[1] as { toString(): string }).toString(), "1000000");
  const accounts = fake.calls[0]?.builder.accounts;
  assert.equal(accounts?.tokenProgram.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  const company = deriveCompanyRegistry(authority, id(1));
  const mandate = deriveMandateLink(company, id(3));
  assert.equal(accounts?.paymentReceipt.toBase58(), derivePaymentReceipt(mandate, id(9)).toBase58());
});

test("status uses Anchor enum shape", async () => {
  const fake = recordingProgram();
  await client(fake.program).setMandateStatus({ companyId: id(1), mandateId: id(3), status: "active" });
  assert.deepEqual(fake.calls[0]?.args, [{ active: {} }]);
});

test("validation rejects unsafe networks, IDs, windows, versions and programs", async () => {
  const fake = recordingProgram();
  assert.throws(() => createRegistryClient({ connection: new Connection("http://localhost:8899"), cluster: "devnet", programOverride: fake.program, wallet: { publicKey: authority } as never }), (error: unknown) => error instanceof RegistryClientError && error.code === "UNSAFE_RPC");
  assert.throws(() => createRegistryClient({ connection: new Connection("https://api.devnet.solana.com"), cluster: "devnet", programId: "11111111111111111111111111111111", programOverride: fake.program, wallet: { publicKey: authority } as never }), (error: unknown) => error instanceof RegistryClientError && error.code === "WRONG_PROGRAM");
  const c = client(fake.program);
  await assert.rejects(() => c.initializeCompany(id(1).subarray(0, 31)), /32 bytes/);
  await assert.rejects(() => c.commitContract({ companyId: id(1), contractId: id(2), documentCommitment: id(4), termsCommitment: id(5), version: 0 }), /positive u32/);
  await assert.rejects(() => c.linkMandate({ companyId: id(1), contractId: id(2), mandateId: id(3), obligationId: id(6), agent: authority.toBase58(), vendor: authority.toBase58(), delegation: authority.toBase58(), assetMint: authority.toBase58(), periodCap: 1n, periodSeconds: 30n, startsAt: 2n, expiresAt: 1n }), /after startsAt/);
  assert.throws(() => id32FromHex("nope"), /64 hexadecimal/);
});
