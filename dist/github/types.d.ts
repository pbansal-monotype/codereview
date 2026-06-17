export interface FileContent {
    path: string;
    content: string;
    truncated: boolean;
}
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
    fileContents: FileContent[];
}
export interface FetchPROptions {
    maxDiffSize: number;
    ignorePatterns: string[];
    redactSecrets: boolean;
    contextFiles: string[];
    includeFileContents: boolean;
    maxFileSize: number;
}
//# sourceMappingURL=types.d.ts.map