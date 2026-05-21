import * as core from '@actions/core';
import { ReviewConfig, CategoryGuidelines, getJsonOutputInstruction } from './config';
import {
  formatFindingsMarkdown,
  hasCriticalFindings,
  StructuredReview,
} from './findings';
import { AIProvider } from './providers';
import { PullRequestData } from './github';

const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  tests: 'Test Coverage',
  performance: 'Performance',
  cost: 'Cost & Infrastructure',
  custom: 'Custom Review',
};

function buildSystemPrompt(config: ReviewConfig): string {
  let prompt = `You are an expert code reviewer for enterprise pull requests.
Review the diff against ALL provided category guidelines in a single pass.
Be concise, specific, and reference file paths and line numbers when possible.
Do NOT repeat the diff. Focus only on actionable findings.

${getJsonOutputInstruction()}`;

  if (config.extraInstructions) {
    prompt += `\n\nAdditional company instructions:\n${config.extraInstructions}`;
  }

  return prompt;
}

function buildCombinedPrompt(
  activeCategories: Array<{ id: string; guidelines: CategoryGuidelines }>,
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
    prompt += `\n### PR Description\n${pr.body}\n`;
  }

  if (config.customPrompt) {
    prompt += `\n### Additional Context\n${config.customPrompt}\n`;
  }

  prompt += `\n## Review Categories\n`;
  for (const { id, guidelines } of activeCategories) {
    const label = CATEGORY_LABELS[id] || id;
    prompt += `\n### ${label} (category id: "${id}")\n${guidelines.guidelines}\n`;
  }

  prompt += `\n## Diff\n\`\`\`diff\n${pr.diff}\n\`\`\`\n`;
  prompt += `\nReview the diff for every category above. Return JSON with findings tagged by category id.`;

  return prompt;
}

export interface ReviewResult {
  markdown: string;
  hasCritical: boolean;
  categories: string[];
  structured?: StructuredReview;
  tokensUsed: number;
}

export async function runReview(
  provider: AIProvider,
  config: ReviewConfig,
  pr: PullRequestData,
): Promise<ReviewResult> {
  const activeCategories: Array<{ id: string; guidelines: CategoryGuidelines }> = [];

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
    };
  }

  if (pr.reviewedFiles.length === 0 && pr.diff.trim().length === 0) {
    return {
      markdown:
        '# 🤖 AI PR Review\n\nNo reviewable files in this PR (all changed files matched ignore patterns).\n',
      hasCritical: false,
      categories: activeCategories.map((c) => c.id),
      tokensUsed: 0,
    };
  }

  const categoryIds = activeCategories.map((c) => c.id);
  core.info(
    `Running combined review for: ${categoryIds.map((id) => CATEGORY_LABELS[id] || id).join(', ')}`,
  );

  const systemPrompt = buildSystemPrompt(config);
  const userPrompt = buildCombinedPrompt(activeCategories, pr, config);

  let response;
  try {
    response = await provider.review({ systemPrompt, userPrompt });
    core.info(`Review complete (${response.tokensUsed} tokens)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    core.error(`Review failed: ${message}`);
    throw err;
  }

  const structured = response.structured;
  const hasCritical = structured
    ? hasCriticalFindings(structured)
    : false;

  const markdown = formatReviewMarkdown(
    response,
    structured,
    pr,
    config,
    activeCategories.map((c) => c.id),
  );

  return {
    markdown,
    hasCritical,
    categories: categoryIds,
    structured,
    tokensUsed: response.tokensUsed,
  };
}

function formatReviewMarkdown(
  response: { review: string },
  structured: StructuredReview | undefined,
  pr: PullRequestData,
  config: ReviewConfig,
  categories: string[],
): string {
  let md = `# 🤖 AI PR Review\n\n`;
  md += `**PR:** #${pr.number} — ${pr.title}\n`;
  md += `**Provider:** ${config.provider} (${config.model})\n`;
  md += `**Files reviewed:** ${pr.reviewedFiles.length} / ${pr.changedFiles.length} changed\n`;

  if (pr.redactionCount > 0) {
    md += `**Secrets redacted:** ${pr.redactionCount} value(s) removed before AI review\n`;
  }

  md += `\n---\n\n`;

  if (structured && structured.findings.length > 0) {
    const critical = structured.findings.filter((f) => f.severity === 'critical').length;
    const warning = structured.findings.filter((f) => f.severity === 'warning').length;
    const suggestion = structured.findings.filter((f) => f.severity === 'suggestion').length;
    md += `**Findings:** 🔴 ${critical} critical · 🟡 ${warning} warning · 🔵 ${suggestion} suggestion\n\n`;
    md += formatFindingsMarkdown(structured, CATEGORY_LABELS);
  } else if (structured) {
    md += structured.summary || 'No issues found.\n';
  } else {
    md += `> ⚠️ Could not parse structured response. Raw output:\n\n`;
    md += response.review.slice(0, 50000);
  }

  md += `\n---\n\n`;
  md += `<details>\n<summary>📊 Review Stats</summary>\n\n`;
  md += `- Categories: ${categories.map((id) => CATEGORY_LABELS[id] || id).join(', ')}\n`;
  md += `- API calls: 1 (combined review)\n`;
  md += `- Provider: ${config.provider} / ${config.model}\n`;
  md += `</details>\n`;

  return md;
}
