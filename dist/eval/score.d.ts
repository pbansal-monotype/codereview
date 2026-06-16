/**
 * score.ts
 *
 * Computes precision, recall, and cost per topology from a results directory
 * produced by run-topologies.ts, then runs a paired Wilcoxon signed-rank test
 * to determine whether topology differences are significant.
 *
 * Usage:
 *   npx ts-node src/eval/score.ts src/eval/results/<run-id>
 *
 * Output:
 *   - Prints a summary table to stdout
 *   - Writes src/eval/results/<run-id>/summary.json
 *
 * Scoring rules:
 *   - Precision = true positives / (true positives + false positives)
 *   - Recall    = true positives / total ground-truth defects
 *   - A finding counts as a true positive if its `category` matches a ground-truth
 *     defect and the finding message is non-vague (i.e. it was not filtered out).
 *   - Optimize for precision; recall >= 0.5 is the minimum floor.
 */
export {};
//# sourceMappingURL=score.d.ts.map