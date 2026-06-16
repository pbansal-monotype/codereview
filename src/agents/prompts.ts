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
  code: 'Code Guidelines',
  custom: 'Custom Review',
};

const SPECIALIST_ROLES: Record<string, string> = {
  security:
    'application security engineer specializing in vulnerability detection, exploitation patterns, and secure coding',
  tests:
    'QA architect specializing in test strategy, coverage analysis, and test reliability',
  performance:
    'performance engineer reviewing one pull request. our ONLY job is to find performance issues: scalability, query efficiency, runtime cost. Ignore everything else (style, security, correctness-unrelated-to-perf, tests) — other specialists own those.',
  code:
    'senior software engineer specializing in code quality, correctness, error handling, and best practices',
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

const TEST_PATH_PATTERNS = [
  /__tests__\//,
  /\.(test|spec)\.[^/]+$/,
  /\/test\//,
  /\/tests\//,
  /\/testing\//,
  /\.stories\.[^/]+$/,
  /\/fixtures\//,
  /\/mocks?\//,
  /\/e2e\//,
  /\/cypress\//,
  /\/playwright\//,
];

function isTestFile(filepath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filepath));
}

export function buildFileContentsSection(
  pr: PullRequestData,
  budget: number,
): string {
  if (pr.fileContents.length === 0 || budget <= 500) return '';

  const sortedFiles = [...pr.fileContents].sort((a, b) => {
    const aIsTest = isTestFile(a.path) ? 1 : 0;
    const bIsTest = isTestFile(b.path) ? 1 : 0;
    return aIsTest - bIsTest;
  });

  let section = `\n## Full File Contents\n`;
  section += `IMPORTANT: Read these carefully. They show the complete code surrounding the changes.\n`;
  section += `Use them to understand:\n`;
  section += `- The full function/class/module the change lives in\n`;
  section += `- What patterns sibling functions use (auth, error handling, validation)\n`;
  section += `- How data flows through imports, types, and helper functions\n`;
  section += `- Whether the changed code is consistent with the rest of the file\n\n`;

  let fileCharsUsed = 0;
  let filesIncluded = 0;
  for (const file of sortedFiles) {
    const ext = file.path.slice(file.path.lastIndexOf('.') + 1);
    const block = `### ${file.path}${file.truncated ? ' (truncated)' : ''}\n\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`;
    if (fileCharsUsed + block.length > budget) {
      const remaining = sortedFiles.length - filesIncluded;
      core.warning(
        `Prompt budget exceeded (${MAX_PROMPT_CHARS} chars). Dropped ${remaining} file(s) from context (test files deprioritized).`,
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
You are reviewing a pull request. Your ONLY job is to find **${label}** issues.
Do NOT look for anything outside your specialty. Other specialists handle other categories.

HOW TO REVIEW:
1. Read the DIFF to see what changed (lines with + are added, - are removed).
2. Read the FULL FILE CONTENTS to understand the complete context:
   - What does the full function/class/handler do?
   - How does data flow through the code?
   - What patterns do sibling functions use? (Does the changed code match them?)
   - What error handling, validation, or auth exists around the changed code?
3. Review the changed code AS PART OF its complete function/API — not as isolated lines.
   - If a new function is added, review the ENTIRE function: inputs, logic, error handling, output.
   - If an existing function is modified, understand what the function does end-to-end and whether the change is correct in that context.
   - If a new API endpoint is added, check the complete handler: auth, validation, business logic, error handling, response.
4. Your findings should be about the changed code, but USE the surrounding context to judge correctness.

QUALITY RULES:
- Every finding must point to a specific file and line.
- Every finding must explain: what's wrong → why it matters in production → how to fix it.
- Prefer silence over noise. Zero findings is a valid and good result.
- Max 4 findings. Keep only the most critical.

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
  const tailInstruction = `\nNow review the changes above in your specialty area.

Step 1: For each changed function/class/handler, read its FULL implementation from the file contents.
Step 2: Understand what it does end-to-end — inputs, processing, outputs, error paths.
Step 3: Evaluate the changed code in that context. Does it introduce a real issue?
Step 4: Only create findings for genuine problems you can prove with specific code references.

Return JSON.`;

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
Specialist reviewers (security, performance, tests, code quality) have already examined the code and produced findings.
Your job is NOT to re-review the code from scratch. Instead, you must:

1. VERIFY each finding against the diff and file context:
   - Does the finding reference real code that actually exists?
   - Is the line number correct?
   - Does the described issue actually exist when you read the surrounding code?
   - Could the issue already be handled elsewhere in the function/file?
2. DEDUPLICATE — aggressively merge findings that describe the same underlying issue:
   - Same file + nearby lines (within 10 lines) + same root cause = DUPLICATE. Keep the best one.
   - Different categories (e.g. security + code) flagging the same missing error handling = DUPLICATE.
   - When merging, pick the finding with the most specific fix and the highest severity.
3. RE-CALIBRATE severity — is "critical" really critical? Would you page the on-call team at 3am? Downgrade if not.
4. FILTER noise — remove findings that are:
   - Vague ("ensure X", "consider Y", "make sure") without specific code and fix
   - About patterns that are actually correct when you read the full context
   - Obvious or unhelpful (things any developer would already know)
   - Already handled by existing code the specialist missed
   - Generic advice that applies to any codebase, not specific to this PR
5. REWRITE messages — each approved finding's message must follow this exact format:
   What is wrong → Why it matters → How to fix it
   Do NOT use brackets. Do NOT use "Ensure...", "Consider...", "Make sure...".
6. SUMMARIZE — write a 1-3 sentence summary of what this PR does and its overall quality.

You are the developer's ally. Only surface findings that will genuinely help them ship better code.
An empty findings array means the code is solid — that's a GOOD outcome.

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
  prompt += `Verify each finding against the diff below. Cross-check with the full context — is the issue real, or did the specialist miss surrounding code that already handles it?\n\n`;

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
