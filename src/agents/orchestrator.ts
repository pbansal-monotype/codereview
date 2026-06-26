import * as core from '@actions/core';
import { ReviewConfig, CategoryGuidelines } from '../config';
import { Finding, hasCriticalFindings, StructuredReview, filterDismissedFindings } from '../output/findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { ReviewResult, ReviewRunOptions, SpecialistResult } from './types';
import { CATEGORY_LABELS, buildSharedContextResult } from '../config/prompts';
import { runSpecialistAgent, buildToolContext } from './specialist';
import { runJudge } from './judge';
import { formatReviewMarkdown } from '../output/format';
import { parseDiffForCommentTargets } from '../context/diff';
import { ToolLoopDebugRecorder } from '../output/debug';
import { collectSpecialistFindings } from '../config/prompts';
import type { FindingSuppression } from '../state/suppression';

function filterFindingsToDiff(
  structured: StructuredReview,
  diff: string,
): { structured: StructuredReview; dropped: Finding[] } {
  const targets = parseDiffForCommentTargets(diff);
  const dropped: Finding[] = [];

  const filteredFindings = structured.findings.filter((f: Finding) => {
    // If we don't have precise location info, keep the finding.
    if (!f.file || typeof f.line !== 'number') return true;

    const fileTargets = targets.get(f.file);
    if (!fileTargets || fileTargets.size === 0) {
      dropped.push(f);
      return false;
    }

    if (!fileTargets.has(f.line)) {
      dropped.push(f);
      return false;
    }

    return true;
  });

  return {
    structured: {
      ...structured,
      findings: filteredFindings,
    },
    dropped,
  };
}

export async function runReview(
  provider: AIProvider,
  config: ReviewConfig,
  pr: PullRequestData,
  options: ReviewRunOptions = {},
): Promise<ReviewResult> {
  const debug = options.debug === true;
  const suppression = options.suppression;
  const activeCategories: Array<{
    id: string;
    guidelines: CategoryGuidelines;
  }> = [];

  for (const [id, guidelines] of Object.entries(config.categories) as [
    string,
    CategoryGuidelines,
  ][]) {
    if (!guidelines.enabled) continue;
    if (!guidelines.guidelines && id !== 'custom') continue;
    if (id === 'custom' && !guidelines.guidelines) continue;
    activeCategories.push({ id, guidelines });
  }

  if (activeCategories.length === 0) {
    core.warning('No review categories enabled.');
    return {
      markdown: '# 🤖 AI PR Review\n\nNo review categories were enabled.\n',
      hasCritical: false,
      categories: [],
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  if (pr.reviewedFiles.length === 0 && pr.diff.trim().length === 0) {
    return {
      markdown:
        '# 🤖 AI PR Review\n\nNo reviewable files in this PR (all changed files matched ignore patterns).\n',
      hasCritical: false,
      categories: activeCategories.map((c) => c.id),
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const categoryIds = activeCategories.map((c) => c.id);
  core.info(
    `Fan-out to ${activeCategories.length} specialists: ${categoryIds.map((id) => CATEGORY_LABELS[id] || id).join(', ')}`,
  );

  const toolCtx = buildToolContext(pr, config);
  const { prompt: sharedContext, reviewContext } = buildSharedContextResult(
    pr,
    config,
    toolCtx.cache,
    debug,
  );
  const debugRecorder = debug ? new ToolLoopDebugRecorder() : undefined;

  // Stage 1: Fan out to all specialist agents in parallel via allSettled so
  // a single crashed specialist never aborts the rest of the pipeline.
  const settled = await Promise.allSettled(
    activeCategories.map((cat) =>
      runSpecialistAgent(
        provider,
        cat.id,
        cat.guidelines,
        pr,
        config,
        sharedContext,
        toolCtx,
        debugRecorder,
        suppression,
      ),
    ),
  );

  const specialistResults: SpecialistResult[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const cat = activeCategories[i];
    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    core.warning(`[${cat.id}] Specialist crashed (unhandled): ${message}`);
    return {
      categoryId: cat.id,
      findings: [],
      tokens: { input: 0, output: 0 },
      apiCalls: 0,
      failed: true,
      error: message,
    };
  });

  const totalSpecialistFindings = specialistResults.reduce(
    (sum, r) => sum + r.findings.length,
    0,
  );
  const failedCount = specialistResults.filter((r) => r.failed).length;
  const specialistApiCalls = specialistResults.reduce((sum, r) => sum + r.apiCalls, 0);

  core.info(
    `Specialists complete: ${totalSpecialistFindings} raw finding(s), ${failedCount} failed agent(s), ` +
    `${specialistApiCalls} specialist API call(s)`,
  );

  for (const result of specialistResults) {
    const label = CATEGORY_LABELS[result.categoryId] || result.categoryId;
    if (result.failed) {
      core.info(`[${result.categoryId}] ${label}: FAILED — ${result.error}`);
      continue;
    }
    if (result.findings.length === 0) {
      core.info(`[${result.categoryId}] ${label}: No issues found ✓`);
      continue;
    }
    for (const f of result.findings) {
      core.info(
        `[${result.categoryId}] ${f.severity.toUpperCase()} ${f.file}:${f.line} — ${f.message}`,
      );
    }
  }

  // Stage 2: Judge — deduplicate findings (single agent call).
  // Parse failures fall back to unverified specialist findings inside runJudge.
  const judgeResult = await runJudge(provider, specialistResults, config);
  const rawJudgeFindings = judgeResult.structured.findings.length;
  const { structured, dropped: diffFilteredOut } = filterFindingsToDiff(
    judgeResult.structured,
    pr.diff,
  );

  if (suppression && suppression.dismissedFingerprints.size > 0) {
    const before = structured.findings.length;
    structured.findings = filterDismissedFindings(
      structured.findings,
      suppression.dismissedFingerprints,
    );
    const removed = before - structured.findings.length;
    if (removed > 0) {
      core.info(`[suppression] Removed ${removed} dismissed finding(s) after judge`);
    }
  }

  const judgeTokens = judgeResult.tokens;

  core.info(`[judge] Final approved findings: ${structured.findings.length}`);
  for (const f of structured.findings) {
    core.info(
      `[judge] ✅ ${f.severity.toUpperCase()} ${f.file}:${f.line} — ${f.message}`,
    );
  }

  const hasCritical = hasCriticalFindings(structured);

  const totalInput =
    specialistResults.reduce((sum, r) => sum + r.tokens.input, 0) +
    judgeTokens.input;
  const totalOutput =
    specialistResults.reduce((sum, r) => sum + r.tokens.output, 0) +
    judgeTokens.output;
  const apiCalls = specialistApiCalls + 1; // +1 for judge

  const markdown = formatReviewMarkdown({
    structured,
    pr,
    config,
    categories: categoryIds,
    totalTokens: { input: totalInput, output: totalOutput },
    apiCalls,
    specialistResults,
    debug: debug
      ? {
          contextStats: reviewContext.stats,
          fileRanking: reviewContext.fileRanking,
          toolCalls: debugRecorder?.calls ?? [],
          diffFilteredOut,
          judgeUnverified: structured.unverified === true,
          judgeRawFindings: collectSpecialistFindings(specialistResults).length,
          judgeFinalFindings: rawJudgeFindings,
        }
      : undefined,
  });

  return {
    markdown,
    hasCritical,
    categories: categoryIds,
    structured,
    tokensUsed: totalInput + totalOutput,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}
