import * as core from '@actions/core';
import { MAX_PROMPT_CHARS } from '../../config';
import { filterDiffByFiles } from '../../filter';
import type { FileDiff, PrepareDiffOptions } from './types';

export const TEST_PATH_PATTERNS = [
  /__tests__\//,
  /\.(test|spec)\.[^/]+$/,
  /\/test\//,
  /\/tests\//,
  /\/testing\//,
  /\.stories\.[^/]+$/,
  /\/fixtures\//,
  /\/mocks?\//,
  /__testdata__/,
  /__fixtures__/,
  /__mocks?__/,
  /\/e2e\//,
  /\/cypress\//,
  /\/playwright\//,
];

export const TEST_FILE_LOW_SCORE = 0.2;

export function isTestFile(filepath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filepath));
}

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
    const { redactSecrets, countRedactions } = await import('../../redact');
    const before = diff;
    diff = redactSecrets(diff);
    redactionCount = countRedactions(before, diff);
    if (redactionCount > 0) {
      core.warning(
        `Redacted ${redactionCount} potential secret(s) from diff before sending to AI`,
      );
    }
  }

  if (diff.length > MAX_PROMPT_CHARS) {
    core.warning(
      `Diff size (${diff.length} chars) exceeds budget (${MAX_PROMPT_CHARS}). Truncating.`,
    );
    diff = smartTruncateDiff(diff, MAX_PROMPT_CHARS);
  }

  return { diff, redactionCount };
}
