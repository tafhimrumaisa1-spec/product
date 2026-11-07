import { canonicalize } from "./canonical";
import { FluxGraphError } from "./errors";
import { sha256Hex } from "./hash";
import type { HashCommitment } from "./primitives";

/** Salts are caller-generated random hex (>= 128 bits). FluxGraph never generates randomness itself. */
const SALT = /^[0-9a-f]{32,128}$/;

/**
 * Salted commitment: sha256("fluxgraph:commit:v1:" + salt + ":" + canonical(value)).
 * Safe to publish; reveals nothing without the salt. Keep the salt in the company's private store.
 */
export function commit(value: unknown, saltHex: string): HashCommitment {
  if (!SALT.test(saltHex)) throw new FluxGraphError("INVALID_SALT", "Salt must be 32-128 lowercase hex characters (>= 128 bits)");
  return `sha256:${sha256Hex(`fluxgraph:commit:v1:${saltHex}:${canonicalize(value)}`)}` as HashCommitment;
}

export function verifyCommitment(commitment: string, value: unknown, saltHex: string): boolean {
  try {
    return commit(value, saltHex) === commitment;
  } catch {
    return false;
  }
}

/**
 * Unsalted domain-separated digest, for NON-confidential material only
 * (policy inputs, forecast inputs, audit hash chain). Never use for contract content.
 */
export function digest(domain: string, value: unknown): HashCommitment {
  return `sha256:${sha256Hex(`fluxgraph:digest:v1:${domain}:${canonicalize(value)}`)}` as HashCommitment;
}
