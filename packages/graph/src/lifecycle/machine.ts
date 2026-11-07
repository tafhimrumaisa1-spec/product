import type { Actor } from "../actor";
import type { DomainEventType } from "../eventTypes";
import type { IsoTimestamp } from "../primitives";

/** Every transition carries who is acting and when. Time is injected, never read from a clock. */
export interface BaseContext {
  readonly actor: Actor;
  readonly at: IsoTimestamp;
}

export type GuardCode =
  | "HUMAN_APPROVAL_REQUIRED"
  | "ACTOR_NOT_PERMITTED"
  | "EXTRACTION_RESULT_MISSING"
  | "NO_MATERIAL_OBLIGATIONS"
  | "MATERIAL_OBLIGATIONS_UNAPPROVED"
  | "EVIDENCE_CITATION_REQUIRED"
  | "CONTRACT_NOT_ACTIVE"
  | "OBLIGATION_NOT_SETTLED"
  | "OBLIGATIONS_NOT_APPROVED"
  | "REGISTRY_EVIDENCE_REQUIRED"
  | "REASON_REQUIRED"
  | "POLICY_DECISION_REQUIRED"
  | "POLICY_OUTCOME_MISMATCH"
  | "TRANSACTION_REQUIRED"
  | "TRANSACTION_SIGNATURE_REQUIRED"
  | "AMOUNT_MISMATCH"
  | "LEDGER_ENTRIES_REQUIRED";

export type GuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: GuardCode; readonly message: string };

export interface TransitionSpec<S extends string, C extends BaseContext> {
  readonly to: S;
  readonly description: string;
  readonly guard?: (ctx: C) => GuardResult;
  /** Dedicated domain event for this transition, or null => emit LifecycleTransitioned. */
  readonly emits: DomainEventType | null;
}

export interface MachineDefinition<S extends string, T extends string, C extends BaseContext> {
  readonly name: string;
  readonly initial: S;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  readonly transitions: { readonly [From in S]: { readonly [Trigger in T]?: TransitionSpec<S, C> } };
}

export const defineMachine = <S extends string, T extends string, C extends BaseContext>(
  def: MachineDefinition<S, T, C>,
): MachineDefinition<S, T, C> => def;

export type TransitionFailureCode = "UNKNOWN_STATE" | "TERMINAL_STATE" | "INVALID_TRANSITION" | "GUARD_FAILED";

export type TransitionOutcome<S extends string, T extends string> =
  | { readonly ok: true; readonly from: S; readonly trigger: T; readonly to: S; readonly emits: DomainEventType | null }
  | {
      readonly ok: false;
      readonly from: string;
      readonly trigger: T;
      readonly code: TransitionFailureCode;
      readonly guardCode: GuardCode | null;
      readonly message: string;
    };

const specFor = <S extends string, T extends string, C extends BaseContext>(
  m: MachineDefinition<S, T, C>,
  from: S,
  trigger: T,
): TransitionSpec<S, C> | undefined => (m.transitions[from] as { [K in T]?: TransitionSpec<S, C> } | undefined)?.[trigger];

/** Pure: decides whether `trigger` is legal from `from` under `ctx`. Never mutates, never throws on bad input. */
export function evaluateTransition<S extends string, T extends string, C extends BaseContext>(
  machine: MachineDefinition<S, T, C>,
  from: string,
  trigger: T,
  ctx: C,
): TransitionOutcome<S, T> {
  const failure = (code: TransitionFailureCode, message: string, guardCode: GuardCode | null = null): TransitionOutcome<S, T> =>
    ({ ok: false, from, trigger, code, guardCode, message });

  if (!(machine.states as readonly string[]).includes(from)) return failure("UNKNOWN_STATE", `${machine.name}: unknown state "${from}"`);
  const state = from as S;
  if (machine.terminal.includes(state)) return failure("TERMINAL_STATE", `${machine.name}: "${from}" is terminal; no further transitions`);
  const spec = specFor(machine, state, trigger);
  if (!spec) return failure("INVALID_TRANSITION", `${machine.name}: trigger ${trigger} is not allowed from "${from}"`);
  if (spec.guard) {
    const g = spec.guard(ctx);
    if (!g.ok) return failure("GUARD_FAILED", `${machine.name}: ${trigger} from "${from}" blocked: ${g.message}`, g.code);
  }
  return { ok: true, from: state, trigger, to: spec.to, emits: spec.emits };
}

export function availableTriggers<S extends string, T extends string, C extends BaseContext>(
  machine: MachineDefinition<S, T, C>,
  from: S,
): T[] {
  return Object.keys(machine.transitions[from] ?? {}) as T[];
}

export const isTerminal = <S extends string, T extends string, C extends BaseContext>(
  machine: MachineDefinition<S, T, C>,
  state: S,
): boolean => machine.terminal.includes(state);

/** All states reachable from `initial` ignoring guards. Used by tests to prove there are no dead states. */
export function reachableStates<S extends string, T extends string, C extends BaseContext>(
  machine: MachineDefinition<S, T, C>,
): Set<S> {
  const seen = new Set<S>([machine.initial]);
  const queue: S[] = [machine.initial];
  while (queue.length > 0) {
    const s = queue.shift()!;
    for (const spec of Object.values(machine.transitions[s] ?? {}) as TransitionSpec<S, C>[]) {
      if (!seen.has(spec.to)) {
        seen.add(spec.to);
        queue.push(spec.to);
      }
    }
  }
  return seen;
}
