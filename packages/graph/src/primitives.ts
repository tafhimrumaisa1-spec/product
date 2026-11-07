import { z } from "zod";

/** Increment when a breaking change is made to any schema in this package. */
export const SCHEMA_VERSION = 1 as const;

/** UTC, whole seconds, trailing Z. Fixed shape means string order == chronological order. */
export const IsoTimestamp = z.string().datetime({ offset: false, precision: 0 });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= dim;
}

export const IsoDate = z.string().refine(isValidIsoDate, "Expected a valid calendar date YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
export type YearMonth = z.infer<typeof YearMonth>;

export function addMonths(ym: string, n: number): string {
  const [ys, ms] = ym.split("-");
  const idx = Number(ys) * 12 + (Number(ms) - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

export const Currency = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Expected an upper-case asset/currency code");
/** Non-negative integer in the asset's smallest unit, as a decimal string (JSON-safe, up to u128). */
export const AmountMinor = z.string().regex(/^(0|[1-9]\d{0,38})$/, "Expected a non-negative integer string");
export const SignedAmountMinor = z.string().regex(/^(0|-?[1-9]\d{0,38})$/, "Expected an integer string");

export const MoneySchema = z.object({ amountMinor: AmountMinor, currency: Currency }).strict();
export const SignedMoneySchema = z.object({ amountMinor: SignedAmountMinor, currency: Currency }).strict();
export type Money = z.infer<typeof MoneySchema>;
export type SignedMoney = z.infer<typeof SignedMoneySchema>;

export const SpendPeriod = z.enum(["weekly", "monthly", "quarterly", "annual"]);
export type SpendPeriod = z.infer<typeof SpendPeriod>;

/** `sha256:<64 hex>`. Used for document commitments, salted term commitments and input digests. */
export const HashCommitment = z.string().regex(/^sha256:[0-9a-f]{64}$/, "Expected sha256:<64 hex>");
export type HashCommitment = z.infer<typeof HashCommitment>;

/** Public keys only. FluxGraph has no field anywhere that can hold a secret key. */
export const SolanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Expected a base58 Solana address");
export const SolanaSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "Expected a base58 Solana signature");

export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Expected a lowercase slug");
export const text = (max: number) => z.string().min(1).max(max);

export type Path = (string | number)[];
export const addIssue = (ctx: z.RefinementCtx, path: Path, message: string): void =>
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
