import {
  buildFixture,
  buildProofTrace,
  type FixtureName,
  type ProofTrace,
} from "../../../../../packages/ledger-proof/source/index";

export type DemoProofScenario = "success" | "over_limit";

export interface DemoProofResult {
  mode: "deterministic_replay";
  synthetic: true;
  onchain: false;
  scenario: DemoProofScenario;
  trace: ProofTrace;
  notice: string;
}

export async function buildPublicDemoProof(scenario: DemoProofScenario): Promise<DemoProofResult> {
  const fixture = await buildFixture(scenario as FixtureName);
  const trace = buildProofTrace(fixture.events, { intentId: fixture.intentId }, { privacy: "public" });
  return {
    mode: "deterministic_replay",
    synthetic: true,
    onchain: false,
    scenario,
    trace: omitSyntheticExplorerLinks(trace),
    notice: "Synthetic proof replay. Explorer links are intentionally omitted because fixture signatures are not real transactions.",
  };
}

export function parseProofScenario(value: unknown): DemoProofScenario | null {
  return value === "success" || value === "over_limit" ? value : null;
}

function omitSyntheticExplorerLinks(trace: ProofTrace): ProofTrace {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      entries: step.entries.map(({ explorerUrl: _omitted, ...entry }) => entry),
    })),
  };
}
