export declare const TEST_PATH_PATTERNS: RegExp[];
export declare function isTestFile(filepath: string): boolean;
/**
 * Truncate a diff at file boundaries instead of cutting mid-file.
 * Prioritizes source code files over tests and configs/docs.
 * Priority: 2 = source code, 1 = test files, 0 = configs/docs.
 *
 * Acts as a hard safety cap — the risk scorer handles fine-grained
 * budget allocation at prompt-assembly time, so this only fires on
 * extremely large PRs that exceed the raw diff size limit.
 */
export declare function smartTruncateDiff(diff: string, maxSize: number): string;
//# sourceMappingURL=diff-utils.d.ts.map