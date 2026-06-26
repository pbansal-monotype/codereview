import type { FileDiff, PrepareDiffOptions } from './types';
export declare const TEST_PATH_PATTERNS: RegExp[];
export declare const TEST_FILE_LOW_SCORE = 0.2;
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
//# sourceMappingURL=loader.d.ts.map