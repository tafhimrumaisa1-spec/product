import type { z } from "zod";
import { canonicalize } from "./canonical";
import { DomainEventSchema, type DomainEvent } from "./events";
import { FluxGraphError } from "./errors";
import { err, ok, type Result } from "./result";

const issues = (e: z.ZodError): string[] => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/** Validate, then emit canonical JSON (sorted keys, no whitespace). Throws SCHEMA_VIOLATION if invalid. */
export function serialize<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FluxGraphError("SCHEMA_VIOLATION", "Refusing to serialize an invalid value", issues(parsed.error));
  return canonicalize(parsed.data);
}

/** Parse JSON text and validate. Never throws. */
export function deserialize<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, json: string): Result<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return err(new FluxGraphError("INVALID_JSON", `Invalid JSON: ${(e as Error).message}`));
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(new FluxGraphError("SCHEMA_VIOLATION", "JSON does not match schema", issues(parsed.error)));
}

export const serializeEvent = (e: DomainEvent): string => serialize(DomainEventSchema, e);
export const deserializeEvent = (json: string): Result<DomainEvent> => deserialize(DomainEventSchema, json);

/** One canonical event per line (JSONL), suitable for append-only logs and event stores of any kind. */
export const eventsToJsonl = (events: readonly DomainEvent[]): string => events.map(serializeEvent).join("\n") + (events.length ? "\n" : "");

export function eventsFromJsonl(jsonl: string): Result<DomainEvent[]> {
  const out: DomainEvent[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const r = deserializeEvent(line);
    if (!r.ok) return err(new FluxGraphError(r.error.code, `Line ${i + 1}: ${r.error.message}`, r.error.details));
    out.push(r.value);
  }
  return ok(out);
}
