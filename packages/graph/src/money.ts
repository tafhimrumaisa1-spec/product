import { FluxGraphError } from "./errors";
import { MoneySchema, SignedMoneySchema, type Money, type SignedMoney } from "./primitives";

type AnyMoney = { readonly amountMinor: string; readonly currency: string };

export const toBigInt = (m: AnyMoney): bigint => BigInt(m.amountMinor);

function normalize(amount: bigint | string | number): bigint {
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount)) throw new FluxGraphError("INVALID_AMOUNT", "Number amounts must be safe integers; pass a string or bigint");
    return BigInt(amount);
  }
  try {
    return BigInt(amount);
  } catch {
    throw new FluxGraphError("INVALID_AMOUNT", `Not an integer amount: ${String(amount)}`);
  }
}

/** Build validated non-negative Money from minor units. */
export function money(amountMinor: bigint | string | number, currency: string): Money {
  const parsed = MoneySchema.safeParse({ amountMinor: normalize(amountMinor).toString(), currency });
  if (!parsed.success) throw new FluxGraphError("INVALID_AMOUNT", "Invalid money value", parsed.error.issues.map((i) => i.message));
  return parsed.data;
}

export function signedMoney(amountMinor: bigint | string | number, currency: string): SignedMoney {
  const parsed = SignedMoneySchema.safeParse({ amountMinor: normalize(amountMinor).toString(), currency });
  if (!parsed.success) throw new FluxGraphError("INVALID_AMOUNT", "Invalid money value", parsed.error.issues.map((i) => i.message));
  return parsed.data;
}

function sameCurrency(a: AnyMoney, b: AnyMoney): void {
  if (a.currency !== b.currency) throw new FluxGraphError("CURRENCY_MISMATCH", `Cannot combine ${a.currency} with ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(toBigInt(a) + toBigInt(b), a.currency);
}

/** a - b, signed (cash positions may go negative). */
export function subtractMoney(a: AnyMoney, b: AnyMoney): SignedMoney {
  sameCurrency(a, b);
  return signedMoney(toBigInt(a) - toBigInt(b), a.currency);
}

export function compareMoney(a: AnyMoney, b: AnyMoney): -1 | 0 | 1 {
  sameCurrency(a, b);
  const x = toBigInt(a);
  const y = toBigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function sumMoney(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}
