export {
  parseDiffForCommentTargets,
  splitDiffByFile,
  isTestFile,
  smartTruncateDiff,
  prepareDiffForReview,
  TEST_PATH_PATTERNS,
} from './loader';
export { buildReviewContext, buildFileSummary } from './builder';
export { scoreFile, THRESHOLDS, RISK_PATH_PATTERNS } from './scorer';
export type {
  RiskPattern,
  FileDiff,
  IncludedFile,
  IncludedFileMode,
  SkippedFile,
  FileRankingEntry,
  ReviewContextStats,
  ReviewContext,
  BuildReviewContextOptions,
  PrepareDiffOptions,
} from './types';
