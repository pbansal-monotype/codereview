// Application-level config (loadConfig, ReviewConfig, constants)
export {
  type CategoryGuidelines,
  type ReviewConfig,
  charsToTokens,
  tokensToChars,
  MAX_PROMPT_TOKENS,
  TIMEOUT_MS,
  MAX_FILE_SIZE,
  SEVERITY_RUBRIC,
  getSpecialistJsonInstruction,
  getJudgeDedupJsonInstruction,
  loadConfig,
  MAX_PROMPT_CHARS,
} from './app';

// Allowed file extensions
export {
  ALLOWED_EXTENSIONS,
  ALLOWED_FILENAMES,
  isAllowedFile,
} from './allowed-extensions';

// Ignore patterns and binary detection
export {
  DEFAULT_IGNORE_PATTERNS,
  BINARY_EXTENSIONS,
} from './ignore-patterns';

// Per-filetype review rules
export {
  FILE_RULES,
  getFileRules,
  getFileRiskWeight,
  getFileReviewHints,
  type FileRule,
} from './file-rules';
