import type { FetchPROptions, PullRequestData } from './types';
export interface FilePartition {
    reviewedFiles: string[];
    /** Every excluded file, whatever the reason — callers strip these from the diff. */
    ignoredFiles: string[];
    /** Subset of ignoredFiles rejected by the extension allowlist rather than an ignore pattern. */
    disallowedFiles: string[];
}
export declare function partitionFiles(allFiles: string[], ignorePatterns: string[]): FilePartition;
export declare function getPullRequestData(token: string, options: FetchPROptions): Promise<PullRequestData>;
//# sourceMappingURL=pr-data.d.ts.map