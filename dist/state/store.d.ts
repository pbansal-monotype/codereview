export interface ReviewState {
    lastReviewedSha: string;
    lastReviewedAt: string;
    reviewCount: number;
}
export interface StateStore {
    get(repo: string, prNumber: number): Promise<ReviewState | null>;
    set(repo: string, prNumber: number, state: ReviewState): Promise<void>;
}
export declare class GistStateStore implements StateStore {
    private octokit;
    private gistId;
    constructor(token: string, gistId: string);
    get(repo: string, prNumber: number): Promise<ReviewState | null>;
    set(repo: string, prNumber: number, state: ReviewState): Promise<void>;
}
export declare class CommitStatusStore implements StateStore {
    private octokit;
    constructor(token: string);
    get(repo: string, prNumber: number): Promise<ReviewState | null>;
    set(repo: string, prNumber: number, state: ReviewState): Promise<void>;
}
export type StoreType = 'gist' | 'comment-marker' | 'none';
export declare function createStateStore(type: StoreType, token: string, gistId?: string): StateStore | null;
//# sourceMappingURL=store.d.ts.map