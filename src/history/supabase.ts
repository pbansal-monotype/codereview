import * as core from '@actions/core';
import { withRetry } from '../retry';
import { sanitizeErrorMessage } from '../sanitize';
import type { FindingRecord, HistoryStore, RunRecord } from './types';

export const RUNS_TABLE = 'pr_review_runs';
export const FINDINGS_TABLE = 'pr_review_findings';

/**
 * History writes are telemetry, so they get a much tighter budget than LLM
 * calls: two attempts and 10s per attempt. A slow database should not hold up
 * a PR check.
 */
const HISTORY_RETRY = { maxAttempts: 2, timeoutMs: 10_000, baseDelayMs: 500 };

/** Findings are chunked so a PR with hundreds of findings cannot exceed request limits. */
const INSERT_CHUNK_SIZE = 500;

/** Injected in tests; defaults to the global fetch (native on Node 18+). */
export type FetchLike = (
  url: string,
  // `body` is omitted for GET — Node's fetch rejects GET requests that carry one.
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Hosted Supabase exposes PostgREST at /rest/v1. A local docker PostgREST
 * (this repo's compose stack) serves tables at the origin root. Appending
 * /rest/v1 there 404s — which is the failure local-review hits.
 */
export function postgrestBaseUrl(supabaseUrl: string): string {
  const trimmed = supabaseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/rest/v1')) return trimmed;

  try {
    const { hostname } = new URL(trimmed);
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
      return trimmed;
    }
  } catch {
    // Fall through to the hosted-Supabase path.
  }

  return `${trimmed}/rest/v1`;
}

export class SupabaseHistoryStore implements HistoryStore {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;

  constructor(supabaseUrl: string, supabaseKey: string, fetchImpl?: FetchLike) {
    this.baseUrl = postgrestBaseUrl(supabaseUrl);
    this.key = supabaseKey;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async record(run: RunRecord, findings: FindingRecord[]): Promise<string | null> {
    try {
      // The run must land first — findings reference it by foreign key.
      await this.insert(RUNS_TABLE, [run]);

      for (let i = 0; i < findings.length; i += INSERT_CHUNK_SIZE) {
        await this.insert(FINDINGS_TABLE, findings.slice(i, i + INSERT_CHUNK_SIZE));
      }

      core.info(
        `[history] Recorded run ${run.id} with ${findings.length} finding(s) to Supabase`,
      );
      return run.id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      core.warning(
        `[history] Failed to record run history: ${sanitizeErrorMessage(message)}. ` +
          `Review results are unaffected.`,
      );
      return null;
    }
  }

  async findReviewForSha(
    repo: string,
    prNumber: number,
    headSha: string,
  ): Promise<{ runId: string; findings: FindingRecord[] } | null> {
    try {
      const runQs =
        `repo=eq.${encodeURIComponent(repo)}` +
        `&pr_number=eq.${prNumber}` +
        `&head_sha=eq.${encodeURIComponent(headSha)}` +
        `&select=id,cached,created_at` +
        `&order=created_at.desc` +
        `&limit=20`;
      const runs = await this.getJson<Array<{ id: string; cached: boolean }>>(
        `${this.baseUrl}/${RUNS_TABLE}?${runQs}`,
      );
      if (!runs || runs.length === 0) return null;

      const chosen = runs.find((r) => r.cached === false) ?? runs[0];
      const findingQs = `run_id=eq.${encodeURIComponent(chosen.id)}&select=*`;
      const findings =
        (await this.getJson<FindingRecord[]>(
          `${this.baseUrl}/${FINDINGS_TABLE}?${findingQs}`,
        )) ?? [];

      return { runId: chosen.id, findings };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      core.warning(
        `[history] Same-SHA lookup failed: ${sanitizeErrorMessage(message)}. Running a full review.`,
      );
      return null;
    }
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw Object.assign(
        new Error(`Supabase GET failed (${response.status}): ${body.slice(0, 300)}`),
        { status: response.status },
      );
    }
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  private async insert(table: string, rows: object[]): Promise<void> {
    if (rows.length === 0) return;

    await withRetry(async () => {
      const response = await this.fetchImpl(`${this.baseUrl}/${table}`, {
        method: 'POST',
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          // Skip the response body; we generate ids client-side and do not read them back.
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // Carry the status so withRetry's isRetryable() can distinguish a
        // transient 503 from a permanent 401 or a schema mismatch (400/404).
        throw Object.assign(
          new Error(`Supabase insert into ${table} failed (${response.status}): ${body.slice(0, 300)}`),
          { status: response.status },
        );
      }
    }, HISTORY_RETRY);
  }
}
