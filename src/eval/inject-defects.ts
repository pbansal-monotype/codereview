/**
 * inject-defects.ts
 *
 * Reads clean PR fixtures from fixtures/clean-prs.json and synthesises
 * "poisoned" variants by injecting known defect patterns into the diff.
 * The output (fixtures/poisoned-prs.json) is used as the recall-floor
 * eval set where every injected defect is a ground-truth positive.
 *
 * Usage:
 *   npx ts-node src/eval/inject-defects.ts
 *   # or after build:
 *   node dist/eval/inject-defects.js
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PullRequestData } from '../github';

// ─── Defect catalogue ─────────────────────────────────────────────

export interface Defect {
  id: string;
  category: 'security' | 'tests' | 'performance' | 'code';
  severity: 'critical' | 'warning' | 'suggestion';
  description: string;
  /** Returns a diff hunk to append to the PR's diff. */
  injectIntoDiff(filename: string): string;
}

export const DEFECT_CATALOGUE: Defect[] = [
  {
    id: 'sql-injection',
    category: 'security',
    severity: 'critical',
    description: 'User input concatenated directly into SQL query string',
    injectIntoDiff: (f) =>
      `diff --git a/${f} b/${f}\n` +
      `--- a/${f}\n+++ b/${f}\n` +
      `@@ -10,6 +10,7 @@\n` +
      ` function getUser(userId: string) {\n` +
      `+  const query = "SELECT * FROM users WHERE id = " + userId;\n` +
      `+  return db.query(query);\n` +
      ` }\n`,
  },
  {
    id: 'hardcoded-secret',
    category: 'security',
    severity: 'critical',
    description: 'Hardcoded API key or password literal in source',
    injectIntoDiff: (f) =>
      `diff --git a/${f} b/${f}\n` +
      `--- a/${f}\n+++ b/${f}\n` +
      `@@ -5,4 +5,5 @@\n` +
      ` export function init() {\n` +
      `+  const apiKey = "sk-prod-AAABBBCCC123456789";\n` +
      ` }\n`,
  },
  {
    id: 'n-plus-one-query',
    category: 'performance',
    severity: 'warning',
    description: 'DB query inside a for-loop (N+1)',
    injectIntoDiff: (f) =>
      `diff --git a/${f} b/${f}\n` +
      `--- a/${f}\n+++ b/${f}\n` +
      `@@ -20,6 +20,9 @@\n` +
      ` for (const item of items) {\n` +
      `+  const detail = await db.query("SELECT * FROM details WHERE item_id = ?", [item.id]);\n` +
      `+  results.push(detail);\n` +
      ` }\n`,
  },
  {
    id: 'missing-test-for-critical-path',
    category: 'tests',
    severity: 'warning',
    description: 'New auth-sensitive function with no corresponding test',
    injectIntoDiff: (f) =>
      `diff --git a/${f} b/${f}\n` +
      `--- a/${f}\n+++ b/${f}\n` +
      `@@ -30,5 +30,10 @@\n` +
      `+export function checkAdminPermission(user: User): boolean {\n` +
      `+  // no test added\n` +
      `+  return user.role === 'admin';\n` +
      `+}\n`,
  },
  {
    id: 'unhandled-promise-rejection',
    category: 'code',
    severity: 'warning',
    description: 'Floating promise — async call without await or .catch()',
    injectIntoDiff: (f) =>
      `diff --git a/${f} b/${f}\n` +
      `--- a/${f}\n+++ b/${f}\n` +
      `@@ -40,4 +40,6 @@\n` +
      ` function handleRequest(req: Request) {\n` +
      `+  sendAnalytics(req.path); // missing await — unhandled rejection\n` +
      ` }\n`,
  },
];

// ─── Fixture types ────────────────────────────────────────────────

export interface CleanPRFixture {
  id: string;
  pr: Omit<PullRequestData, 'diff'> & { diff: string };
}

export interface PoisonedPRFixture {
  id: string;
  baseId: string;
  defectId: string;
  category: string;
  severity: string;
  pr: Omit<PullRequestData, 'diff'> & { diff: string };
  /** Ground-truth annotations: the injected defect is a known positive. */
  groundTruth: {
    file: string;
    category: string;
    severity: string;
    description: string;
  }[];
}

// ─── Injection logic ──────────────────────────────────────────────

export function injectDefects(
  fixture: CleanPRFixture,
  defects: Defect[],
): PoisonedPRFixture[] {
  return defects.map((defect) => {
    const targetFile = fixture.pr.reviewedFiles[0] ?? 'src/target.ts';
    const injectedDiff = fixture.pr.diff + '\n' + defect.injectIntoDiff(targetFile);

    return {
      id: `${fixture.id}__${defect.id}`,
      baseId: fixture.id,
      defectId: defect.id,
      category: defect.category,
      severity: defect.severity,
      pr: {
        ...fixture.pr,
        diff: injectedDiff,
      },
      groundTruth: [
        {
          file: targetFile,
          category: defect.category,
          severity: defect.severity,
          description: defect.description,
        },
      ],
    };
  });
}

// ─── CLI entry point ─────────────────────────────────────────────

function main() {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const cleanPath = path.join(fixturesDir, 'clean-prs.json');

  if (!fs.existsSync(cleanPath)) {
    console.error(
      `No clean PR fixtures found at ${cleanPath}.\n` +
        `Create fixtures/clean-prs.json first (see fixtures/README.md).`,
    );
    process.exit(1);
  }

  const cleanFixtures: CleanPRFixture[] = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));
  const poisoned: PoisonedPRFixture[] = cleanFixtures.flatMap((f) =>
    injectDefects(f, DEFECT_CATALOGUE),
  );

  const outPath = path.join(fixturesDir, 'poisoned-prs.json');
  fs.writeFileSync(outPath, JSON.stringify(poisoned, null, 2));
  console.log(`Wrote ${poisoned.length} poisoned PR fixture(s) to ${outPath}`);
}

if (require.main === module) {
  main();
}
