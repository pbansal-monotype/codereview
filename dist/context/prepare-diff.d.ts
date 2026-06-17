export interface PrepareDiffOptions {
    maxDiffSize: number;
    redactSecrets: boolean;
}
/**
 * Filter ignored files from the raw diff, optionally redact secrets,
 * and truncate at file boundaries if over the size limit.
 */
export declare function prepareDiffForReview(rawDiff: string, ignoredFiles: Set<string>, options: PrepareDiffOptions): Promise<{
    diff: string;
    redactionCount: number;
}>;
//# sourceMappingURL=prepare-diff.d.ts.map