export interface PullRequestData {
    number: number;
    title: string;
    body: string;
    diff: string;
    baseBranch: string;
    headBranch: string;
    author: string;
    changedFiles: string[];
    reviewedFiles: string[];
    ignoredFiles: string[];
    redactionCount: number;
}
export interface FetchPROptions {
    maxDiffSize: number;
    ignorePatterns: string[];
    redactSecrets: boolean;
}
export declare function getPullRequestData(token: string, options: FetchPROptions): Promise<PullRequestData>;
export declare function postReviewComment(token: string, prNumber: number, body: string): Promise<void>;
