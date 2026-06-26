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

export interface FileRankingEntry {
  rank: number;
  filePath: string;
  baseScore: number;
  effectiveScore: number;
  disposition: 'included' | 'skipped';
  mode?: IncludedFileMode;
  skipReason?: string;
  callerRefs: { file: string; line: number; source: string }[];
  isNew: boolean;
  isDeleted: boolean;
}

export interface ReviewContext {
  context: string;
  includedFiles: IncludedFile[];
  skippedFiles: SkippedFile[];
  stats: ReviewContextStats;
  fileRanking: FileRankingEntry[];
}

export interface BuildReviewContextOptions {
  /** True when the diff hunk is a newly added file (not a modification). */
  isNew?: boolean;
  /** Shared per-PR tool cache — reused across context assembly and specialist tool loops. */
  toolCache?: import('../on-demand/tools').ToolCache;
  /** Ignore patterns for blast-radius reference search. */
  ignorePatterns?: string[];
  /** When true, populate fileRanking with per-file scores and disposition. */
  collectRanking?: boolean;
}

export interface PrepareDiffOptions {
  redactSecrets: boolean;
}
