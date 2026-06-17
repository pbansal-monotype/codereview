import * as core from '@actions/core';
import { filterDiffByFiles } from './ignore';

// ─── Types ─────────────────────────────────────────────────────────

export interface RiskPattern {
  pattern: RegExp;
  score: number;
}

export interface FileDiff {
  filePath: string;
  diffHunk: string;
  isDeleted: boolean;
  isNew: boolean;
}

export type IncludedFileMode = 'diff+content' | 'diff-only' | 'diff-only (budget fallback)';

export interface IncludedFile {
  filePath: string;
  mode: IncludedFileMode;
  score: number;
}

export interface SkippedFile {
  filePath: string;
  reason: string;
}

export interface ReviewContextStats {
  totalFiles: number;
  includedCount: number;
  skippedCount: number;
  usedChars: number;
  budgetChars: number;
  utilizationPct: number;
}

export interface ReviewContext {
  context: string;
  includedFiles: IncludedFile[];
  skippedFiles: SkippedFile[];
  stats: ReviewContextStats;
}

export interface BuildReviewContextOptions {
  /** When true, test-file scores are boosted so the tests specialist treats them as high priority. */
  boostTestFiles?: boolean;
}

export interface PrepareDiffOptions {
  maxDiffSize: number;
  redactSecrets: boolean;
}

// ─── Test-file detection ────────────────────────────────────────────

export const TEST_PATH_PATTERNS = [
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

const TEST_FILE_PATTERN = /\.test\.|\.spec\.|__test__|__mock__|_test\./i;
const TEST_FILE_BOOSTED_SCORE = 0.8;

export function isTestFile(filepath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filepath));
}

// ─── Diff splitting ─────────────────────────────────────────────────

/** Split a unified diff string into per-file hunks. */
export function splitDiffByFile(rawDiff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const chunks = rawDiff.split(/^(?=diff --git )/m).filter(Boolean);

  for (const chunk of chunks) {
    const headerMatch = chunk.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (!headerMatch) continue;

    const filePath = headerMatch[1].trim();
    const isDeleted = /^deleted file mode/m.test(chunk);
    const isNew = /^new file mode/m.test(chunk);

    files.push({ filePath, diffHunk: chunk, isDeleted, isNew });
  }

  return files;
}

/**
 * Parse a unified diff to determine which new-file line numbers are valid
 * targets for inline PR review comments.
 */
export function parseDiffForCommentTargets(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();

  for (const { filePath, diffHunk } of splitDiffByFile(diff)) {
    const validLines = new Set<number>();
    const lines = diffHunk.split('\n');
    let newLineNum = 0;
    let inHunk = false;

    for (const line of lines) {
      const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkHeader) {
        newLineNum = parseInt(hunkHeader[1], 10);
        inHunk = true;
        continue;
      }

      if (!inHunk) continue;
      if (line.startsWith('diff --git ')) break;

      if (line.startsWith('+')) {
        validLines.add(newLineNum);
        newLineNum++;
      } else if (line.startsWith('-')) {
        // deleted line — no line number in the new file
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file"
      } else {
        validLines.add(newLineNum);
        newLineNum++;
      }
    }

    if (validLines.size > 0) {
      result.set(filePath, validLines);
    }
  }

  return result;
}

// ─── Diff truncation ────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.rb', '.php', '.cs', '.c', '.cpp', '.h', '.swift', '.kt',
]);

/**
 * Truncate a diff at file boundaries instead of cutting mid-file.
 * Acts as a hard safety cap — buildReviewContext handles fine-grained budgeting.
 */
export function smartTruncateDiff(diff: string, maxSize: number): string {
  const scored = splitDiffByFile(diff)
    .map(({ filePath, diffHunk }) => {
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      const isTest = isTestFile(filePath);
      let priority = 0;
      if (CODE_EXTENSIONS.has(ext)) {
        priority = isTest ? 1 : 2;
      }
      return { chunk: diffHunk, filename: filePath, priority };
    })
    .sort((a, b) => b.priority - a.priority);

  const kept: string[] = [];
  let totalSize = 0;
  const skipped: string[] = [];

  for (const { chunk, filename } of scored) {
    if (totalSize + chunk.length <= maxSize) {
      kept.push(chunk);
      totalSize += chunk.length;
    } else {
      skipped.push(filename);
    }
  }

  if (kept.length === 0 && scored.length > 0) {
    const largest = scored[0];
    core.warning(
      `All diff chunks exceed maxDiffSize (${maxSize}). Force-including a truncated version of ${largest.filename}.`,
    );
    kept.push(largest.chunk.slice(0, maxSize));
  }

  let result = kept.join('');
  if (skipped.length > 0) {
    result +=
      `\n\n... [${skipped.length} file(s) truncated: ` +
      `${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}] ...`;
  }
  return result;
}

/**
 * Filter ignored files from the raw diff, optionally redact secrets,
 * and truncate at file boundaries if over the size limit.
 */
export async function prepareDiffForReview(
  rawDiff: string,
  ignoredFiles: Set<string>,
  options: PrepareDiffOptions,
): Promise<{ diff: string; redactionCount: number }> {
  let diff = filterDiffByFiles(rawDiff, ignoredFiles);
  let redactionCount = 0;

  if (options.redactSecrets) {
    const { redactSecrets, countRedactions } = await import('../redact');
    const before = diff;
    diff = redactSecrets(diff);
    redactionCount = countRedactions(before, diff);
    if (redactionCount > 0) {
      core.warning(
        `Redacted ${redactionCount} potential secret(s) from diff before sending to AI`,
      );
    }
  }

  if (diff.length > options.maxDiffSize) {
    core.warning(
      `Diff size (${diff.length} chars) exceeds max (${options.maxDiffSize}). Truncating.`,
    );
    diff = smartTruncateDiff(diff, options.maxDiffSize);
  }

  return { diff, redactionCount };
}

// ─── Risk scoring ──────────────────────────────────────────────────

export const THRESHOLDS = {
  HIGH_RISK: 0.6,
  MEDIUM_RISK: 0.3,
} as const;

export const RISK_PATH_PATTERNS: RiskPattern[] = [
  { pattern: /auth|login|logout|session|token|jwt|oauth|saml|sso|password|credential/i, score: 0.95 },
  { pattern: /payment|billing|stripe|wallet|invoice|checkout|subscription/i,            score: 0.95 },
  { pattern: /secret|private.?key|api.?key|\.pem|\.pfx|\.p12/i,                         score: 0.95 },
  { pattern: /admin|internal|privileged|superuser|sudo/i,                               score: 0.85 },
  { pattern: /migration|schema|seed|db\/|database\//i,                                  score: 0.80 },
  { pattern: /config\/|\.env|settings\./i,                                              score: 0.75 },
  { pattern: /middleware|interceptor|guard|policy/i,                                    score: 0.75 },
  { pattern: /router|controller|handler|service|repository/i,                           score: 0.60 },
  { pattern: /index\.(js|ts|py|go|java|rb|php|c|cpp|h|swift|kt)$/i,                     score: 0.55 },
  { pattern: TEST_FILE_PATTERN,                                                         score: 0.20 },
  { pattern: /\.md$|README|CHANGELOG|LICENSE|docker|docs\//i,                           score: 0.05 },
  { pattern: /package-lock\.json|yarn\.lock|\.lock$|dist\/|build\//i,                   score: 0.00 },
];

export function scoreFile(
  filePath: string,
  diffHunk: string,
  options: BuildReviewContextOptions = {},
): number {
  let patternScore: number | null = null;

  for (const { pattern, score: s } of RISK_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      const effectiveScore =
        options.boostTestFiles && pattern === TEST_FILE_PATTERN ? TEST_FILE_BOOSTED_SCORE : s;

      if (patternScore === null || effectiveScore > patternScore) {
        patternScore = effectiveScore;
      }
    }
  }

  let score = patternScore !== null ? patternScore : 0.4;

  const linesChanged = (diffHunk.match(/^[+-]/gm) ?? []).length;
  if (linesChanged > 300)      score = Math.min(1.0, score + 0.15);
  else if (linesChanged > 100) score = Math.min(1.0, score + 0.10);
  else if (linesChanged > 50)  score = Math.min(1.0, score + 0.05);

  const additions = (diffHunk.match(/^\+[^+]/gm) ?? []).length;
  const deletions = (diffHunk.match(/^-[^-]/gm) ?? []).length;
  if (additions === 0 && deletions > 0) score = Math.max(0.0, score - 0.1);

  return Math.min(1.0, score);
}

// ─── Context budget allocation ──────────────────────────────────────

export function buildReviewContext(
  rawDiff: string,
  fileContents: Record<string, string>,
  charBudget: number,
  options: BuildReviewContextOptions = {},
): ReviewContext {
  const files = splitDiffByFile(rawDiff);

  const scored = files
    .map((f) => ({ ...f, score: scoreFile(f.filePath, f.diffHunk, options) }))
    .sort((a, b) => b.score - a.score);

  const included: IncludedFile[] = [];
  const skipped: SkippedFile[] = [];
  const sections: string[] = [];
  let usedChars = 0;

  for (const file of scored) {
    const { filePath, diffHunk, score, isDeleted, isNew } = file;

    if (score === 0.0) {
      skipped.push({ filePath, reason: 'auto-generated/lock file' });
      continue;
    }

    if (score < THRESHOLDS.MEDIUM_RISK) {
      skipped.push({ filePath, reason: `low risk (score=${score.toFixed(2)})` });
      continue;
    }

    const wantFullContent = score >= THRESHOLDS.HIGH_RISK && !isDeleted;
    const fullContent = fileContents[filePath] ?? '';

    const diffCost = diffHunk.length;
    const contentCost = wantFullContent ? fullContent.length : 0;
    const totalCost = diffCost + contentCost + 200;

    if (usedChars + totalCost > charBudget) {
      if (wantFullContent && usedChars + diffCost + 200 <= charBudget) {
        sections.push(formatFileSection(filePath, diffHunk, null, score, isDeleted, isNew));
        usedChars += diffCost + 200;
        included.push({ filePath, mode: 'diff-only (budget fallback)', score });
        continue;
      }
      skipped.push({ filePath, reason: `budget exhausted (score=${score.toFixed(2)})` });
      continue;
    }

    const content = wantFullContent ? fullContent : null;
    sections.push(formatFileSection(filePath, diffHunk, content, score, isDeleted, isNew));
    usedChars += totalCost;
    included.push({
      filePath,
      mode: wantFullContent ? 'diff+content' : 'diff-only',
      score,
    });
  }

  return {
    context: sections.join('\n\n'),
    includedFiles: included,
    skippedFiles: skipped,
    stats: {
      totalFiles: files.length,
      includedCount: included.length,
      skippedCount: skipped.length,
      usedChars,
      budgetChars: charBudget,
      utilizationPct: Math.round((usedChars / charBudget) * 100),
    },
  };
}

function formatFileSection(
  filePath: string,
  diffHunk: string,
  fullContent: string | null,
  score: number,
  isDeleted: boolean,
  isNew: boolean,
): string {
  const riskLabel =
    score >= 0.8 ? 'HIGH' :
    score >= 0.6 ? 'MEDIUM-HIGH' :
    score >= 0.3 ? 'MEDIUM' :
    'LOW';

  const status = isNew ? 'NEW FILE' : isDeleted ? 'DELETED' : 'MODIFIED';
  const meta = `<!-- file: ${filePath} | risk: ${riskLabel} (${score.toFixed(2)}) | ${status} -->`;

  let out = `${meta}\n\n`;
  out += `<diff path="${filePath}">\n${diffHunk.trim()}\n</diff>`;

  if (fullContent) {
    out += `\n\n<file path="${filePath}">\n${fullContent.trim()}\n</file>`;
  }

  return out;
}

export function buildFileSummary(
  includedFiles: IncludedFile[],
  skippedFiles: SkippedFile[],
): string {
  const lines: string[] = [];

  lines.push('**Files in context:**');
  for (const { filePath, mode, score } of includedFiles) {
    const icon = score >= 0.8 ? '🔴' : score >= 0.6 ? '🟠' : '🟡';
    lines.push(`  ${icon} \`${filePath}\` (${mode})`);
  }

  if (skippedFiles.length > 0) {
    lines.push('');
    lines.push('**Files excluded from context:**');
    for (const { filePath, reason } of skippedFiles) {
      lines.push(`  ⚪ \`${filePath}\` — ${reason}`);
    }
  }

  return lines.join('\n');
}
