export interface FileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface PullRequestData {
  number: number;
  title: string;
  body: string;
  diff: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  author: string;
  changedFiles: string[];
  reviewedFiles: string[];
  ignoredFiles: string[];
  redactionCount: number;
  fileContents: FileContent[];
  isIncremental: boolean;
  incrementalBaseSha?: string;
}

export interface FetchPROptions {
  maxDiffSize: number;
  ignorePatterns: string[];
  maxFileSize: number;
  lastReviewedSha?: string;
}
