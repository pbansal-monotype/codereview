import * as github from '@actions/github';
export type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getOctokit(token: string): Octokit;
export declare function getRepoContext(): {
    owner: string;
    repo: string;
};
export declare function ghRequest<T>(fn: () => Promise<{
    data: T;
    headers: Record<string, string | undefined>;
}>, label: string): Promise<T>;
//# sourceMappingURL=client.d.ts.map