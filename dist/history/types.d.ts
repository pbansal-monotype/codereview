/**
 * Row shapes for the history store. Field names are snake_case because they map
 * directly onto the Postgres columns in ./schema.sql — PostgREST does no
 * renaming, so the JSON body keys must match the column names exactly.
 */
export interface RunRecord {
    id: string;
    repo: string;
    pr_number: number;
    head_sha: string;
    base_branch: string;
    head_branch: string;
    pr_title: string;
    pr_author: string;
    provider: string;
    model: string;
    categories: string[];
    is_incremental: boolean;
    incremental_base_sha: string | null;
    cached: boolean;
    changed_files_count: number;
    reviewed_files_count: number;
    ignored_files_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    api_calls: number;
    estimated_cost_usd: number | null;
    duration_ms: number;
    findings_count: number;
    critical_count: number;
    warning_count: number;
    suggestion_count: number;
    failed_specialists: string[];
    judge_unverified: boolean;
    github_run_id: string | null;
    github_run_attempt: number | null;
    github_actor: string | null;
    github_workflow: string | null;
}
export interface FindingRecord {
    id: string;
    run_id: string;
    repo: string;
    pr_number: number;
    head_sha: string;
    fingerprint: string;
    category: string;
    severity: string;
    confidence: string;
    file: string;
    line: number | null;
    code_snippet: string | null;
    message: string;
}
export interface HistoryStore {
    /**
     * Persist one run and its findings. Implementations must resolve rather than
     * throw on failure — history is telemetry and must never fail a PR check.
     * Returns the run id on success, or null when nothing was written.
     */
    record(run: RunRecord, findings: FindingRecord[]): Promise<string | null>;
    /**
     * Look up a prior completed review of this exact commit. Used to skip a
     * second LLM pass (same-SHA reuse). Resolves null on miss or any read error.
     */
    findReviewForSha(repo: string, prNumber: number, headSha: string): Promise<{
        runId: string;
        findings: FindingRecord[];
    } | null>;
}
//# sourceMappingURL=types.d.ts.map