import * as core from '@actions/core';
import {
  ReviewConfig,
  MAX_PROMPT_TOKENS,
  tokensToChars,
} from '../app';
import { PullRequestData } from '../../github';
import { buildReviewContext, buildFileSummary } from '../../context/diff';
import type { ReviewContext } from '../../context/diff';
import { ToolCache } from '../../context/on-demand/tools';

export const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  code: 'Code Quality & Performance',
  custom: 'Custom Review',
};

const SPECIALIST_TAIL = `\nNow review the changes above in your specialty area.

Step 1: For each changed function/class/handler, read its FULL implementation from the file contents.
Step 2: Understand what it does end-to-end — inputs, processing, outputs, error paths.
Step 3: Evaluate the changed code in that context. Does it introduce a real issue?
Step 4: Only create findings for genuine problems you can prove with specific code references in the changed code (lines marked with + in the <diff>). Use <file> blocks only as supporting context.

Return JSON.`;

export function buildPrMetadata(
  pr: PullRequestData,
  config: ReviewConfig,
): string {
  let prompt = `## Pull Request\n`;
  prompt += `- **Title:** ${pr.title}\n`;
  prompt += `- **Author:** ${pr.author}\n`;
  prompt += `- **Branch:** ${pr.headBranch} → ${pr.baseBranch}\n`;
  prompt += `- **Files reviewed:** ${pr.reviewedFiles.length} (${pr.reviewedFiles.join(', ') || 'none'})\n`;

  if (pr.ignoredFiles.length > 0) {
    prompt += `- **Files skipped (ignored):** ${pr.ignoredFiles.join(', ')}\n`;
  }

  if (pr.body) {
    prompt += `\n### PR Description\n<pr_description>\n${pr.body}\n</pr_description>\n`;
  }

  if (config.repoContext) {
    prompt += `\n### Repository Context\n${config.repoContext}\n`;
  }

  return prompt;
}

/**
 * Builds the shared context — PR metadata, then the risk-scored file sections
 * (each containing the diff hunk and, for high-risk files, the full file content).
 */
export function buildSharedContext(
  pr: PullRequestData,
  config: ReviewConfig,
  toolCache?: ToolCache,
  collectRanking = false,
): string {
  return buildSharedContextResult(pr, config, toolCache, collectRanking).prompt;
}

export interface SharedContextResult {
  prompt: string;
  reviewContext: ReviewContext;
}

export function buildSharedContextResult(
  pr: PullRequestData,
  config: ReviewConfig,
  toolCache?: ToolCache,
  collectRanking = false,
): SharedContextResult {
  const fileContentsMap: Record<string, string> = {};
  for (const f of pr.fileContents) {
    fileContentsMap[f.path] = f.content;
  }

  const budget = tokensToChars(MAX_PROMPT_TOKENS) - 2000 - SPECIALIST_TAIL.length;

  const reviewContext = buildReviewContext(
    pr.diff,
    fileContentsMap,
    budget,
    { toolCache, ignorePatterns: config.ignorePatterns, collectRanking },
  );

  const { context, includedFiles, skippedFiles, stats } = reviewContext;

  core.info(
    `[context] ${stats.includedCount} files included, ${stats.skippedCount} skipped ` +
    `(${stats.utilizationPct}% of ${stats.budgetChars} char budget used)`,
  );

  let prompt = buildPrMetadata(pr, config);
  prompt += '\n' + buildFileSummary(includedFiles, skippedFiles);
  prompt += '\n\n' + context;
  return { prompt, reviewContext };
}
