export interface RiskPattern {
    pattern: RegExp;
    score: number;
}
export interface FileDiff {
    filePath: string;
    diffHunk: string;
    isDeleted: boolean;
    isNew: boolean;
}
export type IncludedFileMode = 'diff+content' | 'diff-only' | 'diff-only (budget fallback)';
export interface IncludedFile {
    filePath: string;
    mode: IncludedFileMode;
    score: number;
}
export interface SkippedFile {
    filePath: string;
    reason: string;
}
export interface ReviewContextStats {
    totalFiles: number;
    includedCount: number;
    skippedCount: number;
    usedChars: number;
    budgetChars: number;
    utilizationPct: number;
}
export interface ReviewContext {
    context: string;
    includedFiles: IncludedFile[];
    skippedFiles: SkippedFile[];
    stats: ReviewContextStats;
}
export interface BuildReviewContextOptions {
    /** When true, test-file pattern scores are boosted from 0.20 → 0.80.
     *  Use for the tests specialist so test files are treated as high priority. */
    boostTestFiles?: boolean;
}
export declare const THRESHOLDS: {
    /** diff + full file content */
    readonly HIGH_RISK: 0.6;
    /** diff only */
    readonly MEDIUM_RISK: 0.3;
};
export declare const RISK_PATH_PATTERNS: RiskPattern[];
/**
 * Score a single file. Returns 0.0–1.0 (higher = more important to include).
 * When boostTestFiles is true, test-file matches are scored at TEST_FILE_BOOSTED_SCORE
 * instead of 0.20 so the tests specialist sees them as high priority.
 */
export declare function scoreFile(filePath: string, diffHunk: string, options?: BuildReviewContextOptions): number;
/** Split a unified diff string into per-file hunks. */
export declare function splitDiffByFile(rawDiff: string): FileDiff[];
/**
 * Build the review context string within a character budget.
 * Files are scored by risk, sorted highest → lowest, and greedily filled into the budget:
 *   - score >= HIGH_RISK  → diff + full file content
 *   - score >= MEDIUM_RISK → diff only
 *   - score <  MEDIUM_RISK → skipped entirely
 *   - score === 0.00       → always skipped (auto-generated / lock files)
 */
export declare function buildReviewContext(rawDiff: string, fileContents: Record<string, string>, charBudget: number, options?: BuildReviewContextOptions): ReviewContext;
/**
 * Build the "files reviewed / skipped" summary block for the PR review comment header.
 */
export declare function buildFileSummary(includedFiles: IncludedFile[], skippedFiles: SkippedFile[]): string;
//# sourceMappingURL=risk-scorer.d.ts.map