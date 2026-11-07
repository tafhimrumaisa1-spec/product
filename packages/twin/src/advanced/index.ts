/** FluxTwin public API. Pure, deterministic, framework-independent. */
export { runTwin, computeTwin, buildComparison } from './engine';
export { validateTwinInput } from './validate';
export type { ValidationResult } from './validate';
export { buildScenarios, DEFAULT_BASE_ASSUMPTIONS } from './scenarios';
export { formatMonthsX100, comparableRunwayX100 } from './facts';
export { parseMonth, formatMonth } from './months';
export { MAX_MINOR } from './money';
export * from './types';
export { goldenDemoInput } from './fixtures/golden-demo';
