export { parseIgnorePatterns, shouldIgnoreFile, filterDiffByFiles, isBinaryFile } from '../filter';
export {
  parseDiffForCommentTargets,
  splitDiffByFile,
  isTestFile,
  smartTruncateDiff,
  prepareDiffForReview,
  buildReviewContext,
  buildFileSummary,
  scoreFile,
  THRESHOLDS,
  RISK_PATH_PATTERNS,
  TEST_PATH_PATTERNS,
} from './diff';
export {
  ToolCache,
  createToolContext,
  readFile,
  searchText,
  findReferences,
  fileImportsTarget,
  extractSymbolsFromFile,
  findBlastRadiusCallers,
  runSpecialistToolLoop,
  specialistUsesToolLoop,
} from './on-demand';
export type {
  ToolContext,
  ReferenceLocation,
  ReferenceSource,
  ToolLoopResult,
} from './on-demand';
export type {
  RiskPattern,
  FileDiff,
  IncludedFile,
  IncludedFileMode,
  SkippedFile,
  ReviewContextStats,
  ReviewContext,
  BuildReviewContextOptions,
  PrepareDiffOptions,
} from './diff';
