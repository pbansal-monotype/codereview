import * as core from '@actions/core';
import { ReviewConfig, CategoryGuidelines } from '../config';
import { Finding, hasCriticalFindings, StructuredReview } from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { ReviewResult, SpecialistResult } from './types';
import { CATEGORY_LABELS, buildSharedContext } from './prompts';
import { runSpecialistAgent } from './specialist';
import { runJudge } from './judge';
import { formatReviewMarkdown } from './format';
import { parseDiffForCommentTargets } from '../context/diff';

function filterFindingsToDiff(structured: StructuredReview, diff: string): StructuredReview {
  const targets = parseDiffForCommentTargets(diff);

  const filteredFindings = structured.findings.filter((f: Finding) => {
    // If we don't have precise location info, keep the finding.
    if (!f.file || typeof f.line !== 'number') return true;

    const fileTargets = targets.get(f.file);
    if (!fileTargets || fileTargets.size === 0) return false;

    return fileTargets.has(f.line);
  });

  return {
    ...structured,
    findings: filteredFindings,
  };
}

export async function runReview(
  provider: AIProvider,
  config: ReviewConfig,
  pr: PullRequestData,
): Promise<ReviewResult> {
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

  // Build shared context once per ordering variant:
  //   - Default (test files deprioritized) — used by all specialists except tests.
  //   - Test-prioritized — used by the tests specialist so test files are never dropped first.
  const sharedContext = buildSharedContext(pr, config, false);
  const testSharedContext = categoryIds.includes('tests')
    ? buildSharedContext(pr, config, true)
    : sharedContext;

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
        cat.id === 'tests' ? testSharedContext : sharedContext,
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
      failed: true,
      error: message,
    };
  });

  const totalSpecialistFindings = specialistResults.reduce(
    (sum, r) => sum + r.findings.length,
    0,
  );
  const failedCount = specialistResults.filter((r) => r.failed).length;

  core.info(
    `Specialists complete: ${totalSpecialistFindings} raw finding(s), ${failedCount} failed agent(s)`,
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
  const structured = filterFindingsToDiff(judgeResult.structured, pr.diff);
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
  const apiCalls = activeCategories.length + 1;

  const markdown = formatReviewMarkdown({
    structured,
    pr,
    config,
    categories: categoryIds,
    totalTokens: { input: totalInput, output: totalOutput },
    apiCalls,
    specialistResults,
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
