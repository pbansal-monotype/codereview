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
    /** When true, test-file scores are boosted so the tests specialist treats them as high priority. */
    boostTestFiles?: boolean;
    /** True when the diff hunk is a newly added file (not a modification). */
    isNew?: boolean;
}
export interface PrepareDiffOptions {
    maxDiffSize: number;
    redactSecrets: boolean;
}
export declare const TEST_PATH_PATTERNS: RegExp[];
export declare function isTestFile(filepath: string): boolean;
/** Split a unified diff string into per-file hunks. */
export declare function splitDiffByFile(rawDiff: string): FileDiff[];
/**
 * Parse a unified diff to determine which new-file line numbers are valid
 * targets for inline PR review comments.
 */
export declare function parseDiffForCommentTargets(diff: string): Map<string, Set<number>>;
/**
 * Truncate a diff at file boundaries instead of cutting mid-file.
 * Acts as a hard safety cap — buildReviewContext handles fine-grained budgeting.
 */
export declare function smartTruncateDiff(diff: string, maxSize: number): string;
/**
 * Filter ignored files from the raw diff, optionally redact secrets,
 * and truncate at file boundaries if over the size limit.
 */
export declare function prepareDiffForReview(rawDiff: string, ignoredFiles: Set<string>, options: PrepareDiffOptions): Promise<{
    diff: string;
    redactionCount: number;
}>;
export declare const THRESHOLDS: {
    readonly HIGH_RISK: 0.6;
    readonly MEDIUM_RISK: 0.3;
};
export declare const RISK_PATH_PATTERNS: RiskPattern[];
export declare function scoreFile(filePath: string, diffHunk: string, options?: BuildReviewContextOptions): number;
export declare function buildReviewContext(rawDiff: string, fileContents: Record<string, string>, charBudget: number, options?: BuildReviewContextOptions): ReviewContext;
export declare function buildFileSummary(includedFiles: IncludedFile[], skippedFiles: SkippedFile[]): string;
//# sourceMappingURL=diff.d.ts.map