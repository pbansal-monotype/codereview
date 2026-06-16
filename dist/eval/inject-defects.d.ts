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
import type { PullRequestData } from '../github';
export interface Defect {
    id: string;
    category: 'security' | 'tests' | 'performance' | 'code';
    severity: 'critical' | 'warning' | 'suggestion';
    description: string;
    /** Returns a diff hunk to append to the PR's diff. */
    injectIntoDiff(filename: string): string;
}
export declare const DEFECT_CATALOGUE: Defect[];
export interface CleanPRFixture {
    id: string;
    pr: Omit<PullRequestData, 'diff'> & {
        diff: string;
    };
}
export interface PoisonedPRFixture {
    id: string;
    baseId: string;
    defectId: string;
    category: string;
    severity: string;
    pr: Omit<PullRequestData, 'diff'> & {
        diff: string;
    };
    /** Ground-truth annotations: the injected defect is a known positive. */
    groundTruth: {
        file: string;
        category: string;
        severity: string;
        description: string;
    }[];
}
export declare function injectDefects(fixture: CleanPRFixture, defects: Defect[]): PoisonedPRFixture[];
//# sourceMappingURL=inject-defects.d.ts.map