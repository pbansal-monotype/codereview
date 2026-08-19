import { randomUUID } from 'node:crypto';
import type { ReviewConfig } from '../config';
import { estimateCost } from '../cost';
import { findingFingerprint, buildJudgeReviewFromDedup, type Finding, type StructuredReview } from '../output/findings';
import type { PullRequestData } from '../github';
import type { SpecialistResult } from '../agents/types';
import type { FindingRecord, RunRecord } from './types';

export interface BuildRecordInput {
  repo: string;
  pr: PullRequestData;
  config: ReviewConfig;
  structured?: StructuredReview;
  categories: string[];
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  durationMs: number;
  /** True when the run replayed stored findings for an already-reviewed SHA. */
  cached: boolean;
  specialistResults?: SpecialistResult[];
  /** Actions run metadata; absent outside a workflow (e.g. the local CLI). */
  githubContext?: {
    runId?: string;
    runAttempt?: string;
    actor?: string;
    workflow?: string;
  };
}

/** Parse a numeric estimate out of the display-oriented estimateCost() string. */
function costToNumber(model: string, inputTokens: number, outputTokens: number): number | null {
  const formatted = estimateCost(model, inputTokens, outputTokens);
  if (formatted === null) return null;
  // "<$0.001" means a real but negligible spend; record it as zero rather than null
  // so the column distinguishes "too small to measure" from "unknown model".
  if (formatted === '<$0.001') return 0;
  const parsed = Number.parseFloat(formatted.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function countSeverity(findings: Finding[], severity: string): number {
  return findings.filter((f) => f.severity === severity).length;
}

function intOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRunRecord(input: BuildRecordInput): {
  run: RunRecord;
  findings: FindingRecord[];
} {
  const { pr, config, repo } = input;
  const findings = input.structured?.findings ?? [];
  const runId = randomUUID();
  const gh = input.githubContext ?? {};

  const run: RunRecord = {
    id: runId,
    repo,
    pr_number: pr.number,
    head_sha: pr.headSha,
    base_branch: pr.baseBranch,
    head_branch: pr.headBranch,
    pr_title: pr.title,
    pr_author: pr.author,

    provider: config.provider,
    model: config.model,
    categories: input.categories,
    is_incremental: pr.isIncremental,
    incremental_base_sha: pr.incrementalBaseSha ?? null,
    cached: input.cached,

    changed_files_count: pr.changedFiles.length,
    reviewed_files_count: pr.reviewedFiles.length,
    ignored_files_count: pr.ignoredFiles.length,

    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    total_tokens: input.inputTokens + input.outputTokens,
    api_calls: input.apiCalls,
    estimated_cost_usd: costToNumber(config.model, input.inputTokens, input.outputTokens),
    duration_ms: input.durationMs,

    findings_count: findings.length,
    critical_count: countSeverity(findings, 'critical'),
    warning_count: countSeverity(findings, 'warning'),
    suggestion_count: countSeverity(findings, 'suggestion'),
    failed_specialists: (input.specialistResults ?? [])
      .filter((r) => r.failed)
      .map((r) => r.categoryId),
    judge_unverified: input.structured?.unverified === true,

    github_run_id: gh.runId ?? null,
    github_run_attempt: intOrNull(gh.runAttempt),
    github_actor: gh.actor ?? null,
    github_workflow: gh.workflow ?? null,
  };

  const findingRecords: FindingRecord[] = findings.map((f) => ({
    id: randomUUID(),
    run_id: runId,
    repo,
    pr_number: pr.number,
    head_sha: pr.headSha,
    fingerprint: findingFingerprint(f),
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    file: f.file ?? '',
    line: typeof f.line === 'number' ? f.line : null,
    code_snippet: f.codeSnippet ?? null,
    message: f.message,
  }));

  return { run, findings: findingRecords };
}

/** Rebuild a StructuredReview from history rows so a same-SHA replay needs no LLM. */
export function structuredFromHistoryFindings(rows: FindingRecord[]): StructuredReview {
  const findings: Finding[] = rows.map((r) => ({
    category: r.category,
    severity: r.severity as Finding['severity'],
    confidence: r.confidence as Finding['confidence'],
    file: r.file,
    line: r.line ?? undefined,
    codeSnippet: r.code_snippet ?? undefined,
    message: r.message,
  }));
  return buildJudgeReviewFromDedup(findings);
}
