/**
 * run-topologies.ts
 *
 * Runs the four topology variants on every PR fixture at temperature 0:
 *   - single-call / no-judge
 *   - single-call / with-judge
 *   - fan-out    / no-judge
 *   - fan-out    / with-judge  ← current production topology
 *
 * Only the topology varies; rubric, schema, and temperature are held constant.
 * Writes raw LLM responses to results/<run-id>/<fixture-id>/<topology>.json
 * for downstream scoring by score.ts.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx ts-node src/eval/run-topologies.ts [fixture-file]
 *   # fixture-file defaults to src/eval/fixtures/poisoned-prs.json
 *   # Override topology: --topologies single-no-judge,fanout-judge
 */
export {};
//# sourceMappingURL=run-topologies.d.ts.map