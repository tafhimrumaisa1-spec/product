import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMoney, canonicalize, commit, compareMoney, deriveId, digest, FluxGraphError, idKindOf, IsoDate, money, parseId,
  sha256Hex, subtractMoney, sumMoney, utf8Encode, verifyCommitment, addMonths, Money, MoneySchema, SignedMoneySchema, IsoTimestamp,
} from "../src/index";

test("sha256 matches NIST vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  assert.equal(sha256Hex("a".repeat(1_000_000)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("sha256 handles padding boundaries (55, 56, 63, 64 bytes) like node:crypto", async () => {
  const { createHash } = await import("node:crypto");
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
    const s = "x".repeat(n);
    assert.equal(sha256Hex(s), createHash("sha256").update(s).digest("hex"), `length ${n}`);
  }
});

test("utf8Encode matches TextEncoder incl. astral and lone surrogates", () => {
  const samples = ["héllo", "日本語", "emoji 😀 ok", "lone \ud800 surrogate", "\udc00"];
  for (const s of samples) assert.deepEqual([...utf8Encode(s)], [...new TextEncoder().encode(s)], s);
});

test("canonicalize sorts keys, is whitespace-free and order-independent", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonicalize({ a: 1, b: { d: 1, c: 2 } }), canonicalize({ b: { c: 2, d: 1 }, a: 1 }));
});

test("canonicalize rejects ambiguous or unsafe values", () => {
  for (const bad of [undefined, NaN, Infinity, 10n, () => 1, Symbol("s"), new Date(), new Map(), { a: undefined }]) {
    assert.throws(() => canonicalize(bad), (e: unknown) => e instanceof FluxGraphError && e.code === "CANONICALIZATION_ERROR");
  }
  const cyc: Record<string, unknown> = {};
  cyc["self"] = cyc;
  assert.throws(() => canonicalize(cyc), /circular/);
  const shared = { x: 1 };
  assert.doesNotThrow(() => canonicalize({ a: shared, b: shared }), "shared (non-cyclic) references are fine");
});

test("deriveId is stable, domain-separated and well-formed", () => {
  const a = deriveId("contract", "ns", 1);
  assert.equal(a, deriveId("contract", "ns", 1));
  assert.notEqual(a, deriveId("contract", "ns", 2));
  assert.notEqual(a.slice(4), deriveId("mandate", "ns", 1).slice(4), "kind participates in the hash");
  assert.match(a, /^ctr_[0-9a-f]{24}$/);
  assert.equal(idKindOf(a), "contract");
  assert.equal(idKindOf("ctr_zz"), null);
  assert.equal(idKindOf("xxx_" + "0".repeat(24)), null);
  assert.throws(() => deriveId("contract"), (e: unknown) => e instanceof FluxGraphError && e.code === "INVALID_ID");
});

test("parseId rejects ids of the wrong kind", () => {
  const mandate = deriveId("mandate", "m");
  assert.equal(parseId("mandate", mandate), mandate);
  assert.throws(() => parseId("contract", mandate), (e: unknown) => e instanceof FluxGraphError && e.code === "INVALID_ID");
  assert.throws(() => parseId("contract", 42));
});

test("commitments are salted, verifiable and reject weak salts", () => {
  const salt1 = "00112233445566778899aabbccddeeff";
  const salt2 = "ffeeddccbbaa99887766554433221100";
  const c1 = commit({ cap: "12000" }, salt1);
  assert.match(c1, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(c1, commit({ cap: "12000" }, salt2), "different salt => different commitment");
  assert.equal(c1, commit({ cap: "12000" }, salt1));
  assert.ok(verifyCommitment(c1, { cap: "12000" }, salt1));
  assert.ok(!verifyCommitment(c1, { cap: "12001" }, salt1));
  assert.ok(!verifyCommitment(c1, { cap: "12000" }, salt2));
  assert.ok(!verifyCommitment(c1, { cap: "12000" }, "short"), "bad salt => false, not throw");
  for (const weak of ["", "abc", "ZZ".repeat(20), "0".repeat(31)]) {
    assert.throws(() => commit("x", weak), (e: unknown) => e instanceof FluxGraphError && e.code === "INVALID_SALT");
  }
  assert.notEqual(digest("a", 1), digest("b", 1), "digest is domain-separated");
});

test("money: exact integer arithmetic beyond 2^53, currency safety", () => {
  const big = money("9007199254740993", "USDC");
  assert.equal(addMoney(big, money(1, "USDC")).amountMinor, "9007199254740994");
  assert.equal(subtractMoney(money(5, "USDC"), money(8, "USDC")).amountMinor, "-3");
  assert.equal(compareMoney(money(5, "USDC"), money(8, "USDC")), -1);
  assert.equal(sumMoney([money(1, "USDC"), money(2, "USDC")], "USDC").amountMinor, "3");
  assert.equal(sumMoney([], "USDC").amountMinor, "0");
  assert.throws(() => addMoney(money(1, "USDC"), money(1, "USD")), (e: unknown) => e instanceof FluxGraphError && e.code === "CURRENCY_MISMATCH");
  assert.throws(() => money(1.5, "USDC"), (e: unknown) => e instanceof FluxGraphError && e.code === "INVALID_AMOUNT");
  assert.throws(() => money(Number.MAX_SAFE_INTEGER + 2, "USDC"), /safe integers/);
  assert.throws(() => money(-1, "USDC"), (e: unknown) => e instanceof FluxGraphError && e.code === "INVALID_AMOUNT");
  assert.throws(() => money("12abc", "USDC"), /Not an integer/);
  assert.throws(() => money(1, "usdc"), /Invalid money/);
});

test("money schemas reject floats, exponents, leading zeros and extra keys", () => {
  for (const bad of ["1.5", "1e3", "01", "-1", "", " 1", "+1"]) assert.ok(!MoneySchema.safeParse({ amountMinor: bad, currency: "USDC" }).success, `unsigned ${bad}`);
  assert.ok(SignedMoneySchema.safeParse({ amountMinor: "-1", currency: "USDC" }).success);
  assert.ok(!SignedMoneySchema.safeParse({ amountMinor: "-0", currency: "USDC" }).success);
  assert.ok(!MoneySchema.safeParse({ amountMinor: "1", currency: "USDC", extra: 1 }).success);
  assert.ok(!MoneySchema.safeParse({ amountMinor: 1, currency: "USDC" }).success, "numbers are not accepted");
  const m: Money = money(1, "USDC");
  assert.ok(m);
});

test("dates and timestamps are strictly validated", () => {
  assert.ok(IsoDate.safeParse("2028-02-29").success, "leap day");
  for (const bad of ["2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "26-01-01", "2026-1-1"]) assert.ok(!IsoDate.safeParse(bad).success, bad);
  assert.ok(IsoTimestamp.safeParse("2026-10-05T09:00:00Z").success);
  for (const bad of ["2026-10-05T09:00:00.500Z", "2026-10-05T09:00:00+01:00", "2026-10-05 09:00:00", "2026-10-05"]) assert.ok(!IsoTimestamp.safeParse(bad).success, bad);
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});
