import * as core from '@actions/core';
import {
  ReviewConfig,
  getSpecialistJsonInstruction,
  getJudgeJsonInstruction,
  MAX_PROMPT_CHARS,
} from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';

export const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  tests: 'Test Coverage',
  performance: 'Performance',
  cost: 'Cost & Infrastructure',
  custom: 'Custom Review',
};

const SPECIALIST_ROLES: Record<string, string> = {
  security:
    'application security engineer specializing in vulnerability detection, exploitation patterns, and secure coding',
  tests:
    'QA architect specializing in test strategy, coverage analysis, and test reliability',
  performance:
    'performance engineer specializing in scalability, query optimization, and runtime efficiency',
  cost:
    'cloud infrastructure economist specializing in cost optimization and billing impact analysis',
  custom:
    'senior engineer conducting a focused review based on the provided guidelines',
};

// ─── Shared prompt helpers ─────────────────────────────────────────

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
    prompt += `\n### PR Description\n${pr.body}\n`;
  }

  if (config.customPrompt) {
    prompt += `\n### Additional Context\n${config.customPrompt}\n`;
  }

  return prompt;
}

export function buildFileContentsSection(
  pr: PullRequestData,
  budget: number,
): string {
  if (pr.fileContents.length === 0 || budget <= 500) return '';

  let section = `\n## File Contents (full context)\n`;
  section += `Use these to understand the complete code structure, imports, types, and surrounding logic.\n\n`;

  let fileCharsUsed = 0;
  let filesIncluded = 0;
  for (const file of pr.fileContents) {
    const ext = file.path.slice(file.path.lastIndexOf('.') + 1);
    const block = `### ${file.path}${file.truncated ? ' (truncated)' : ''}\n\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`;
    if (fileCharsUsed + block.length > budget) {
      const remaining = pr.fileContents.length - filesIncluded;
      core.warning(
        `Prompt budget exceeded (${MAX_PROMPT_CHARS} chars). Dropped ${remaining} file(s) from context.`,
      );
      break;
    }
    section += block;
    fileCharsUsed += block.length;
    filesIncluded++;
  }

  return section;
}

// ─── Specialist prompts ────────────────────────────────────────────

export function buildSpecialistSystemPrompt(
  categoryId: string,
  guidelines: string,
  config: ReviewConfig,
): string {
  const role = SPECIALIST_ROLES[categoryId] || SPECIALIST_ROLES.custom;
  const label = CATEGORY_LABELS[categoryId] || categoryId;

  let prompt = `You are a ${role}.
You are reviewing a pull request diff. Your ONLY job is to find **${label}** issues.
Do NOT look for anything outside your specialty. Other specialists handle other categories.

RULES:
1. ONLY flag issues you can prove by pointing to specific changed lines (+ lines) in the diff.
2. Every finding must be specific: what exact code is wrong, what breaks in production, how to fix it.
3. Prefer silence over noise. Zero findings is a perfectly valid result — it means the code is solid in your area.
4. Use the file contents for context ONLY. Don't flag issues in unchanged code.
5. Max 4 findings. If you found more, keep only the most critical.

YOUR DOMAIN GUIDELINES:
${guidelines}

${getSpecialistJsonInstruction()}`;

  if (config.extraInstructions) {
    prompt += `\n\nAdditional company instructions:\n${config.extraInstructions}`;
  }

  return prompt;
}

export function buildSpecialistUserPrompt(
  pr: PullRequestData,
  config: ReviewConfig,
): string {
  let prompt = buildPrMetadata(pr, config);

  const diffSection = `\n## Diff (what changed)\n\`\`\`diff\n${pr.diff}\n\`\`\`\n`;
  const tailInstruction = `\nReview the diff above. Focus ONLY on your specialty area. Return JSON.`;

  const budgetForFiles =
    MAX_PROMPT_CHARS -
    prompt.length -
    diffSection.length -
    tailInstruction.length;

  prompt += buildFileContentsSection(pr, budgetForFiles);
  prompt += diffSection;
  prompt += tailInstruction;

  return prompt;
}

// ─── Judge prompts ─────────────────────────────────────────────────

export function buildJudgeSystemPrompt(config: ReviewConfig): string {
  let prompt = `You are a principal engineer and the final quality gate for an AI-assisted PR review.
Specialist reviewers (security, performance, tests, cost) have already examined the code and produced findings.
Your job is NOT to re-review the code from scratch. Instead, you must:

1. VERIFY each finding against the diff — does the finding reference real code that actually exists in the changed lines? If the line number or code snippet doesn't match the diff, REJECT the finding.
2. DEDUPLICATE — if multiple specialists flagged the same underlying issue, keep the best-written one.
3. RE-CALIBRATE severity — is "critical" really critical? Would you page the on-call team? Downgrade if not.
4. FILTER noise — remove findings that are:
   - Vague ("ensure X", "consider Y") without specific code references
   - About unchanged code (context lines, not + lines)
   - Obvious or unhelpful (things any developer would already know)
   - Speculative without evidence in the diff
5. SUMMARIZE — write a 1-3 sentence summary of the PR quality and what it does.

You are the developer's ally, not their adversary. Only surface findings that will genuinely help.
An empty findings array means the specialists found nothing noteworthy — that's a GOOD outcome.

${getJudgeJsonInstruction()}`;

  if (config.extraInstructions) {
    prompt += `\n\nAdditional company instructions:\n${config.extraInstructions}`;
  }

  return prompt;
}

export function buildJudgeUserPrompt(
  specialistResults: SpecialistResult[],
  pr: PullRequestData,
): string {
  let prompt = `## PR: ${pr.title}\n`;
  prompt += `**Author:** ${pr.author} | **Branch:** ${pr.headBranch} → ${pr.baseBranch}\n`;

  if (pr.body) {
    prompt += `\n### PR Description\n${pr.body}\n`;
  }

  prompt += `\n## Raw Findings from Specialist Reviewers\n`;
  prompt += `Verify each finding against the diff below. Keep only findings that are real, specific, and actionable.\n\n`;

  let totalFindings = 0;
  for (const result of specialistResults) {
    const label = CATEGORY_LABELS[result.categoryId] || result.categoryId;

    if (result.failed) {
      prompt += `### ${label} Agent: FAILED (${result.error})\n\n`;
      continue;
    }

    if (result.findings.length === 0) {
      prompt += `### ${label} Agent: No issues found ✓\n\n`;
      continue;
    }

    prompt += `### ${label} Agent (category id: "${result.categoryId}")\n`;
    prompt += '```json\n';
    prompt += JSON.stringify(
      result.findings.map((f) => ({
        severity: f.severity,
        confidence: f.confidence,
        file: f.file,
        line: f.line,
        message: f.message,
      })),
      null,
      2,
    );
    prompt += '\n```\n\n';
    totalFindings += result.findings.length;
  }

  if (totalFindings === 0) {
    prompt += `\n**All specialists reported clean — no issues found.**\n`;
    prompt += `Write a brief positive summary and return an empty findings array.\n`;
  }

  const maxJudgeDiff = 80_000;
  const diff =
    pr.diff.length > maxJudgeDiff
      ? pr.diff.slice(0, maxJudgeDiff) + '\n... [diff truncated for judge review]'
      : pr.diff;

  prompt += `\n## Diff (for verification)\n\`\`\`diff\n${diff}\n\`\`\`\n`;
  prompt += `\nVerify each finding against this diff. Return the final consolidated JSON with only verified, high-quality findings.`;

  return prompt;
}
