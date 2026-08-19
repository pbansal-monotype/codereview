import { type Octokit } from '../github/client';
import type { PullRequestData } from '../github';
export declare function loadDotEnv(envPath?: string): void;
export declare function parseArgs(argv: string[]): {
    repo: string;
    pr: number;
    debug: boolean;
    force: boolean;
};
export declare function buildPullRequestData(repoSlug: string, prNumber: number, githubToken: string, ignorePatterns: string[], octokit?: Octokit): Promise<PullRequestData>;
//# sourceMappingURL=local-review.d.ts.map