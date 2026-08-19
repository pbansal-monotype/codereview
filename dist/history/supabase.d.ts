import type { FindingRecord, HistoryStore, RunRecord } from './types';
export declare const RUNS_TABLE = "pr_review_runs";
export declare const FINDINGS_TABLE = "pr_review_findings";
/** Injected in tests; defaults to the global fetch (native on Node 18+). */
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;
/**
 * Hosted Supabase exposes PostgREST at /rest/v1. A local docker PostgREST
 * (this repo's compose stack) serves tables at the origin root. Appending
 * /rest/v1 there 404s — which is the failure local-review hits.
 */
export declare function postgrestBaseUrl(supabaseUrl: string): string;
export declare class SupabaseHistoryStore implements HistoryStore {
    private readonly baseUrl;
    private readonly key;
    private readonly fetchImpl;
    constructor(supabaseUrl: string, supabaseKey: string, fetchImpl?: FetchLike);
    record(run: RunRecord, findings: FindingRecord[]): Promise<string | null>;
    findReviewForSha(repo: string, prNumber: number, headSha: string): Promise<{
        runId: string;
        findings: FindingRecord[];
    } | null>;
    private getJson;
    private insert;
}
//# sourceMappingURL=supabase.d.ts.map