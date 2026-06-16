import * as core from '@actions/core';
import { ReviewConfig, CategoryGuidelines } from '../config';
import { hasCriticalFindings } from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { ReviewResult } from './types';
import { CATEGORY_LABELS } from './prompts';
import { runSpecialistAgent } from './specialist';
import { runJudge } from './judge';
import { formatReviewMarkdown } from './format';

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

  // Stage 1: Fan out to all specialist agents in parallel
  const specialistResults = await Promise.all(
    activeCategories.map((cat) =>
      runSpecialistAgent(provider, cat.id, cat.guidelines, pr, config),
    ),
  );

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

  // Stage 2: Run judge agent to verify, deduplicate, and rate findings
  let judgeTokens = { input: 0, output: 0 };
  let structured;

  try {
    const judgeResult = await runJudge(
      provider,
      specialistResults,
      pr,
      config,
    );
    structured = judgeResult.structured;
    judgeTokens = judgeResult.tokens;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(
      `[judge] Judge failed: ${message} — falling back to raw specialist findings`,
    );
    const allFindings = specialistResults.flatMap((r) => r.findings);
    structured = {
      summary: 'Judge unavailable. Showing unfiltered specialist findings.',
      findings: allFindings,
    };
  }

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
