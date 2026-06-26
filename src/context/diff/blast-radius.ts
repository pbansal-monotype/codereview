import {
  extractSymbolsFromFile,
  findBlastRadiusCallers,
  type ReferenceLocation,
  type ToolContext,
} from '../on-demand/tools';
import type { FileDiff } from './types';
import { THRESHOLDS } from './scorer';

const BLAST_RADIUS_SCORE_BUMP = 0.25;
const MAX_BLAST_RADIUS_CALLERS = 3;

export interface ScoredFile extends FileDiff {
  score: number;
  effectiveScore: number;
  callerRefs: ReferenceLocation[];
}

function basenameWithoutExt(filePath: string): string {
  const base = filePath.includes('/')
    ? filePath.slice(filePath.lastIndexOf('/') + 1)
    : filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function applyBlastRadiusScoring(
  scored: Array<FileDiff & { score: number }>,
  fileContents: Record<string, string>,
  toolCtx: ToolContext,
): ScoredFile[] {
  const highRisk = scored.filter((f) => f.score >= THRESHOLDS.HIGH_RISK && !f.isDeleted);
  const highRiskWithContent = highRisk.map((f) => ({
    filePath: f.filePath,
    content: fileContents[f.filePath] ?? '',
  }));

  return scored.map((file) => {
    let effectiveScore = file.score;
    let callerRefs: ReferenceLocation[] = [];

    if (file.score < THRESHOLDS.HIGH_RISK && !file.isDeleted) {
      const content = fileContents[file.filePath] ?? '';
      const symbols = extractSymbolsFromFile(file.filePath, file.diffHunk, content);

      const callers = findBlastRadiusCallers(
        toolCtx,
        file.filePath,
        symbols.length > 0 ? symbols : [basenameWithoutExt(file.filePath)],
        highRiskWithContent,
        MAX_BLAST_RADIUS_CALLERS,
      );

      if (callers.length > 0) {
        effectiveScore = Math.min(
          1.0,
          Math.max(file.score + BLAST_RADIUS_SCORE_BUMP, THRESHOLDS.MEDIUM_RISK + 0.15),
        );
        callerRefs = callers;
      }
    }

    return { ...file, effectiveScore, callerRefs };
  });
}
