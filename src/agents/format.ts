import { ReviewConfig } from '../config';
import { formatFindingsMarkdown, StructuredReview } from '../findings';
import { estimateCost } from '../cost';
import { PullRequestData } from '../github';
import { SpecialistResult, TokenUsage } from './types';
import { CATEGORY_LABELS } from './prompts';

interface FormatOptions {
  structured?: StructuredReview;
  pr: PullRequestData;
  config: ReviewConfig;
  categories: string[];
  totalTokens: TokenUsage;
  apiCalls: number;
  specialistResults: SpecialistResult[];
}

function unverifiedBanner(structured: StructuredReview): string {
  if (!structured.unverified) return '';

  return (
    `\n> ⚠️ **Judge output is unverified** — the dedup stage failed to parse. ` +
    `Findings below are raw specialist output and may include duplicates. ` +
    `Review manually before acting on these.\n`
  );
}

export function formatReviewMarkdown(opts: FormatOptions): string {
  const { structured, pr, config, categories, totalTokens, apiCalls } = opts;

  let md = `# 🤖 AI PR Review\n\n`;
  md += `**PR:** #${pr.number} — ${pr.title}\n`;
  md += `**Provider:** ${config.provider} (${config.model})\n`;
  md += `**Mode:** Multi-agent (${apiCalls - 1} specialists + dedup judge)\n`;
  md += `**Files reviewed:** ${pr.reviewedFiles.length} / ${pr.changedFiles.length} changed\n`;

  if (pr.redactionCount > 0) {
    md += `**Secrets redacted:** ${pr.redactionCount} value(s) removed before AI review\n`;
  }

  if (structured) {
    md += unverifiedBanner(structured);
  }

  // Surface failed specialists prominently — a crashed agent must never look like a clean pass.
  const failedSpecialists = opts.specialistResults.filter((r) => r.failed);
  if (failedSpecialists.length > 0) {
    md += `\n> ⚠️ **${failedSpecialists.length} specialist(s) failed — results are incomplete:**\n`;
    for (const r of failedSpecialists) {
      const label = CATEGORY_LABELS[r.categoryId] || r.categoryId;
      md += `> - **${label}**: ${r.error ?? 'unknown error'}\n`;
    }
    md += `> Review these areas manually before merging.\n`;
  }

  if (structured) {
    const criticalCount = structured.findings.filter(
      (f) => f.severity === 'critical',
    ).length;
    if (criticalCount > 0) {
      md += `\n> 🚨 **${criticalCount} critical issue(s) found**\n`;
    } else if (structured.findings.length > 0) {
      md += `\n> ✅ **No critical issues — ${structured.findings.length} suggestion(s)/warning(s)**\n`;
    } else if (failedSpecialists.length > 0) {
      md += `\n> ⚠️ **Incomplete review — see failed specialists above**\n`;
    } else {
      md += `\n> ✅ **All clear — no issues found**\n`;
    }
  }

  md += `\n---\n\n`;

  if (structured && structured.findings.length > 0) {
    const critical = structured.findings.filter(
      (f) => f.severity === 'critical',
    ).length;
    const warning = structured.findings.filter(
      (f) => f.severity === 'warning',
    ).length;
    const suggestion = structured.findings.filter(
      (f) => f.severity === 'suggestion',
    ).length;
    md += `**Findings:** 🔴 ${critical} critical · 🟡 ${warning} warning · 🔵 ${suggestion} suggestion\n\n`;
    md += formatFindingsMarkdown(structured, CATEGORY_LABELS);
  } else if (structured) {
    md += structured.summary || 'No issues found.\n';
  }

  md += `\n---\n\n`;
  md += `<details>\n<summary>📊 Review Stats</summary>\n\n`;
  md += `- Categories: ${categories.map((id) => CATEGORY_LABELS[id] || id).join(', ')}\n`;
  md += `- API calls: ${apiCalls} (${apiCalls - 1} specialist + 1 judge)\n`;
  md += `- Tokens: ${totalTokens.input.toLocaleString()} input + ${totalTokens.output.toLocaleString()} output = ${(totalTokens.input + totalTokens.output).toLocaleString()} total\n`;

  const cost = estimateCost(
    config.model,
    totalTokens.input,
    totalTokens.output,
  );
  if (cost) {
    md += `- Estimated cost: ${cost}\n`;
  }

  md += `\n**Specialist breakdown:**\n`;
  for (const r of opts.specialistResults) {
    const label = CATEGORY_LABELS[r.categoryId] || r.categoryId;
    const status = r.failed
      ? '❌ failed'
      : `${r.findings.length} raw finding(s)`;
    md += `- ${label}: ${status} (${(r.tokens.input + r.tokens.output).toLocaleString()} tokens)\n`;
  }

  md += `- Provider: ${config.provider} / ${config.model}\n`;
  md += `</details>\n`;

  return md;
}
