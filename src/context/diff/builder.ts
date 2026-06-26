import {
  createToolContext,
  type ReferenceLocation,
} from '../on-demand/tools';
import { applyBlastRadiusScoring } from './blast-radius';
import { splitDiffByFile } from './loader';
import { scoreFile, THRESHOLDS } from './scorer';
import type {
  BuildReviewContextOptions,
  FileRankingEntry,
  IncludedFile,
  IncludedFileMode,
  ReviewContext,
  SkippedFile,
} from './types';

export function buildReviewContext(
  rawDiff: string,
  fileContents: Record<string, string>,
  charBudget: number,
  options: BuildReviewContextOptions = {},
): ReviewContext {
  const files = splitDiffByFile(rawDiff);

  const initiallyScored = files.map((f) => ({
    ...f,
    score: scoreFile(f.filePath, f.diffHunk, { ...options, isNew: f.isNew }),
  }));

  const toolCtx = createToolContext(
    fileContents,
    options.ignorePatterns ?? [],
    options.toolCache,
  );

  const scored = applyBlastRadiusScoring(initiallyScored, fileContents, toolCtx).sort(
    (a, b) => b.effectiveScore - a.effectiveScore,
  );

  const included: IncludedFile[] = [];
  const skipped: SkippedFile[] = [];
  const fileRanking: FileRankingEntry[] = [];
  const sections: string[] = [];
  let usedChars = 0;

  for (let rank = 0; rank < scored.length; rank++) {
    const file = scored[rank];
    const { filePath, diffHunk, score, effectiveScore, callerRefs, isDeleted, isNew } =
      file;

    const pushRanking = (
      disposition: FileRankingEntry['disposition'],
      extra: Pick<FileRankingEntry, 'mode' | 'skipReason'> = {},
    ): void => {
      if (!options.collectRanking) return;
      fileRanking.push({
        rank: rank + 1,
        filePath,
        baseScore: score,
        effectiveScore,
        disposition,
        callerRefs: callerRefs.map((c) => ({
          file: c.file,
          line: c.line,
          source: c.source,
        })),
        isNew,
        isDeleted,
        ...extra,
      });
    };

    if (score === 0.0) {
      skipped.push({ filePath, reason: 'auto-generated/lock file' });
      pushRanking('skipped', { skipReason: 'auto-generated/lock file' });
      continue;
    }

    const wantFullContent = effectiveScore >= THRESHOLDS.HIGH_RISK && !isDeleted;
    const fullContent = fileContents[filePath] ?? '';

    const callerCost = formatCallerRefs(filePath, callerRefs).length;
    const diffCost = diffHunk.length;
    const contentCost = wantFullContent ? fullContent.length : 0;
    const totalCost = diffCost + contentCost + callerCost + 200;

    if (usedChars + totalCost > charBudget) {
      if (usedChars + diffCost + callerCost + 200 <= charBudget) {
        sections.push(
          formatFileSection(
            filePath,
            diffHunk,
            null,
            effectiveScore,
            isDeleted,
            isNew,
            callerRefs,
          ),
        );
        usedChars += diffCost + callerCost + 200;
        const mode: IncludedFileMode =
          callerRefs.length > 0 ? 'diff-only' : 'diff-only (budget fallback)';
        included.push({ filePath, mode, score: effectiveScore });
        pushRanking('included', { mode });
        continue;
      }
      skipped.push({ filePath, reason: `budget exhausted (score=${effectiveScore.toFixed(2)})` });
      pushRanking('skipped', { skipReason: `budget exhausted (score=${effectiveScore.toFixed(2)})` });
      continue;
    }

    const content = wantFullContent ? fullContent : null;
    sections.push(
      formatFileSection(filePath, diffHunk, content, effectiveScore, isDeleted, isNew, callerRefs),
    );
    usedChars += totalCost;
    const includedMode: IncludedFileMode = wantFullContent ? 'diff+content' : 'diff-only';
    included.push({
      filePath,
      mode: includedMode,
      score: effectiveScore,
    });
    pushRanking('included', { mode: includedMode });
  }

  return {
    context: sections.join('\n\n'),
    includedFiles: included,
    skippedFiles: skipped,
    fileRanking,
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

function formatCallerRefs(targetPath: string, callers: ReferenceLocation[]): string {
  if (callers.length === 0) return '';

  const lines = callers.map(
    (c) => `  ${c.file}:${c.line} [${c.source}]\n    ${c.snippet}`,
  );
  return (
    `\n\n<caller-references target="${targetPath}">\n` +
    `Referenced by higher-risk callers:\n${lines.join('\n')}\n</caller-references>`
  );
}

function formatFileSection(
  filePath: string,
  diffHunk: string,
  fullContent: string | null,
  score: number,
  isDeleted: boolean,
  isNew: boolean,
  callerRefs: ReferenceLocation[] = [],
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
  out += formatCallerRefs(filePath, callerRefs);

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
