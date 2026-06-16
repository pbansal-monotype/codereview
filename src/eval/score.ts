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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Finding } from '../findings';
import type { PoisonedPRFixture } from './inject-defects';

// ─── Types ────────────────────────────────────────────────────────

interface TopologyResult {
  topology: string;
  findings: Finding[];
  error?: string;
}

interface GroundTruth {
  file: string;
  category: string;
  severity: string;
  description: string;
}

interface PRScore {
  fixtureId: string;
  topology: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

interface TopologySummary {
  topology: string;
  meanPrecision: number;
  meanRecall: number;
  prCount: number;
}

// ─── Matching ─────────────────────────────────────────────────────

/**
 * A finding is a true positive if its category matches any ground-truth defect.
 * (Coarse matching — sufficient for recall-floor eval. Annotated gold-standard
 * evals require human review for fine-grained precision.)
 */
function matchesGroundTruth(finding: Finding, groundTruth: GroundTruth[]): boolean {
  return groundTruth.some((gt) => gt.category === finding.category);
}

function scoreFindings(
  findings: Finding[],
  groundTruth: GroundTruth[],
): { tp: number; fp: number; fn: number; precision: number; recall: number } {
  const matched = new Set<number>();
  let tp = 0;
  let fp = 0;

  for (const finding of findings) {
    const idx = groundTruth.findIndex(
      (gt, i) => !matched.has(i) && gt.category === finding.category,
    );
    if (idx !== -1) {
      tp++;
      matched.add(idx);
    } else {
      fp++;
    }
  }

  const fn = groundTruth.length - tp;
  const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp);
  const recall = groundTruth.length === 0 ? 1.0 : tp / groundTruth.length;

  return { tp, fp, fn, precision, recall };
}

// ─── Paired Wilcoxon signed-rank test (non-parametric) ────────────

/**
 * Minimal implementation of the Wilcoxon signed-rank test for two paired
 * samples. Returns the W statistic and a rough two-tailed p-value.
 * For production use, replace with a proper stats library.
 */
function wilcoxonSignedRank(a: number[], b: number[]): { W: number; p: number } {
  const diffs = a.map((v, i) => v - b[i]).filter((d) => d !== 0);
  if (diffs.length === 0) return { W: 0, p: 1.0 };

  const ranked = [...diffs]
    .map((d, i) => ({ diff: d, abs: Math.abs(d), origIdx: i }))
    .sort((x, y) => x.abs - y.abs)
    .map((entry, rank) => ({ ...entry, rank: rank + 1 }));

  let Wpos = 0;
  let Wneg = 0;
  for (const r of ranked) {
    if (r.diff > 0) Wpos += r.rank;
    else Wneg += r.rank;
  }
  const W = Math.min(Wpos, Wneg);
  const n = diffs.length;
  // Approximate normal Z for large samples: mean = n(n+1)/4, sd = sqrt(n(n+1)(2n+1)/24)
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = Math.abs((W - mean) / sd);
  // Two-tailed p-value approximation using standard normal CDF.
  const p = 2 * (1 - standardNormalCDF(z));
  return { W, p };
}

function standardNormalCDF(z: number): number {
  // Abramowitz and Stegun approximation (accurate to ±1.5e-7).
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
}

// ─── Main scoring logic ───────────────────────────────────────────

function main() {
  const runDir = process.argv[2];
  if (!runDir || !fs.existsSync(runDir)) {
    console.error('Usage: score.ts <results-dir>');
    process.exit(1);
  }

  const fixtureDirs = fs.readdirSync(runDir).filter((d) => {
    const p = path.join(runDir, d);
    return fs.statSync(p).isDirectory();
  });

  const allScores: PRScore[] = [];

  for (const fixtureId of fixtureDirs) {
    const fixtureDir = path.join(runDir, fixtureId);
    const gtPath = path.join(fixtureDir, 'ground-truth.json');
    if (!fs.existsSync(gtPath)) continue;

    const groundTruth: GroundTruth[] = JSON.parse(fs.readFileSync(gtPath, 'utf8'));

    const resultFiles = fs.readdirSync(fixtureDir).filter(
      (f) => f.endsWith('.json') && f !== 'ground-truth.json',
    );

    for (const rf of resultFiles) {
      if (rf.endsWith('.error.json')) continue;
      const topology = rf.replace('.json', '');
      const result: TopologyResult = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, rf), 'utf8'),
      );
      const findings: Finding[] = result.findings ?? [];
      const { tp, fp, fn, precision, recall } = scoreFindings(findings, groundTruth);
      allScores.push({ fixtureId, topology, tp, fp, fn, precision, recall });
    }
  }

  // ─── Aggregate by topology ───────────────────────────────────────

  const byTopology = new Map<string, PRScore[]>();
  for (const score of allScores) {
    const list = byTopology.get(score.topology) ?? [];
    list.push(score);
    byTopology.set(score.topology, list);
  }

  const summaries: TopologySummary[] = [];
  for (const [topology, scores] of byTopology) {
    const meanPrecision = scores.reduce((s, r) => s + r.precision, 0) / scores.length;
    const meanRecall = scores.reduce((s, r) => s + r.recall, 0) / scores.length;
    summaries.push({ topology, meanPrecision, meanRecall, prCount: scores.length });
  }

  summaries.sort((a, b) => b.meanPrecision - a.meanPrecision);

  // ─── Significance tests ───────────────────────────────────────────

  const topologyIds = [...byTopology.keys()];
  const sigTests: object[] = [];
  for (let i = 0; i < topologyIds.length; i++) {
    for (let j = i + 1; j < topologyIds.length; j++) {
      const aId = topologyIds[i];
      const bId = topologyIds[j];
      const aScores = byTopology.get(aId)!;
      const bScores = byTopology.get(bId)!;
      const sharedIds = aScores
        .map((s) => s.fixtureId)
        .filter((id) => bScores.some((s) => s.fixtureId === id));

      if (sharedIds.length < 5) {
        sigTests.push({ pair: `${aId} vs ${bId}`, note: 'too few paired samples' });
        continue;
      }

      const aPrec = sharedIds.map((id) => aScores.find((s) => s.fixtureId === id)!.precision);
      const bPrec = sharedIds.map((id) => bScores.find((s) => s.fixtureId === id)!.precision);
      const { W, p } = wilcoxonSignedRank(aPrec, bPrec);
      sigTests.push({
        pair: `${aId} vs ${bId}`,
        W,
        p: p.toFixed(4),
        significant: p < 0.05,
        n: sharedIds.length,
      });
    }
  }

  // ─── Output ───────────────────────────────────────────────────────

  console.log('\n=== Topology Comparison ===\n');
  console.log(
    'Topology'.padEnd(20) +
      'Precision'.padEnd(12) +
      'Recall'.padEnd(10) +
      'PRs',
  );
  console.log('-'.repeat(50));
  for (const s of summaries) {
    const recallNote = s.meanRecall < 0.5 ? ' ⚠️ below floor' : '';
    console.log(
      s.topology.padEnd(20) +
        s.meanPrecision.toFixed(3).padEnd(12) +
        (s.meanRecall.toFixed(3) + recallNote).padEnd(20) +
        s.prCount,
    );
  }

  if (sigTests.length > 0) {
    console.log('\n=== Significance Tests (Wilcoxon signed-rank, precision) ===\n');
    for (const t of sigTests) {
      console.log(JSON.stringify(t));
    }
  }

  const summaryPath = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ summaries, sigTests, allScores }, null, 2));
  console.log(`\nFull results written to: ${summaryPath}`);

  // Decision guidance
  const best = summaries[0];
  if (best.meanRecall < 0.5) {
    console.log('\n⚠️  Best topology fails the recall floor (< 0.5). Do not ship until recall improves.');
  } else {
    console.log(
      `\n✅ Best topology: ${best.topology} (precision=${best.meanPrecision.toFixed(3)}, recall=${best.meanRecall.toFixed(3)})`,
    );
    console.log(
      '   Only invest further in multi-agent fan-out if "fanout-judge" precision > "single-judge" precision at p < 0.05.',
    );
  }
}

main();
