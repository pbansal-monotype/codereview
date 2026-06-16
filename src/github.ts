import * as core from '@actions/core';
import * as github from '@actions/github';
import { filterDiffByFiles, shouldIgnoreFile } from './ignore';
import { parseDiffForCommentTargets } from './diff-parser';
import { Finding } from './findings';

// ─── GitHub API rate-limit awareness ────────────────────────────────

const RATE_LIMIT_WARN_THRESHOLD = 100;

function checkRateLimitHeaders(headers: Record<string, string | undefined>): void {
  const remaining = headers['x-ratelimit-remaining'];
  if (remaining === undefined) return;

  const remainingNum = parseInt(remaining, 10);
  if (Number.isNaN(remainingNum)) return;

  if (remainingNum <= 0) {
    const resetEpoch = parseInt(headers['x-ratelimit-reset'] ?? '0', 10);
    const waitSec = Math.max(0, resetEpoch - Math.floor(Date.now() / 1000));
    core.warning(
      `GitHub API rate limit exhausted. Resets in ${waitSec}s. Subsequent requests may fail.`,
    );
  } else if (remainingNum < RATE_LIMIT_WARN_THRESHOLD) {
    core.warning(
      `GitHub API rate limit running low: ${remainingNum} requests remaining.`,
    );
  }
}

async function ghRequest<T>(
  fn: () => Promise<{ data: T; headers: Record<string, string | undefined> }>,
  label: string,
): Promise<T> {
  try {
    const response = await fn();
    checkRateLimitHeaders(response.headers);
    return response.data;
  } catch (err: unknown) {
    if (
      err != null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 403
    ) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/rate limit/i.test(msg)) {
        core.error(`GitHub API rate limit hit during ${label}. Aborting.`);
      }
    }
    throw err;
  }
}

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
  author: string;
  changedFiles: string[];
  reviewedFiles: string[];
  ignoredFiles: string[];
  redactionCount: number;
  fileContents: FileContent[];
}

export interface FetchPROptions {
  maxDiffSize: number;
  ignorePatterns: string[];
  redactSecrets: boolean;
  contextFiles: string[];
  includeFileContents: boolean;
  maxFileSize: number;
}

async function listAllChangedFiles(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const filenames: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });

    filenames.push(...data.map((f) => f.filename));
    if (data.length < 100) break;
    page++;
  }

  return filenames;
}

export async function getPullRequestData(
  token: string,
  options: FetchPROptions,
): Promise<PullRequestData> {
  const octokit = github.getOctokit(token);
  const context = github.context;

  if (!context.payload.pull_request) {
    throw new Error('This action can only run on pull_request events.');
  }

  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data: rawDiff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });

  const allFiles = await listAllChangedFiles(octokit, owner, repo, prNumber);
  const ignoredFiles = allFiles.filter((f) =>
    shouldIgnoreFile(f, options.ignorePatterns),
  );
  const reviewedFiles = allFiles.filter(
    (f) => !shouldIgnoreFile(f, options.ignorePatterns),
  );

  if (ignoredFiles.length > 0) {
    core.info(
      `Skipping ${ignoredFiles.length} ignored file(s): ${ignoredFiles.slice(0, 10).join(', ')}${ignoredFiles.length > 10 ? '...' : ''}`,
    );
  }

  const ignoredSet = new Set(ignoredFiles);
  let diffText = rawDiff as unknown as string;
  diffText = filterDiffByFiles(diffText, ignoredSet);

  let redactionCount = 0;
  if (options.redactSecrets) {
    const { redactSecrets, countRedactions } = await import('./redact');
    const before = diffText;
    diffText = redactSecrets(diffText);
    redactionCount = countRedactions(before, diffText);
    if (redactionCount > 0) {
      core.warning(
        `Redacted ${redactionCount} potential secret(s) from diff before sending to AI`,
      );
    }
  }

  if (diffText.length > options.maxDiffSize) {
    core.warning(
      `Diff size (${diffText.length} chars) exceeds max (${options.maxDiffSize}). Truncating.`,
    );
    diffText = smartTruncateDiff(diffText, options.maxDiffSize);
  }

  if (reviewedFiles.length === 0) {
    core.warning('No reviewable files after applying ignore patterns.');
  }

  // Fetch full file contents for changed files + explicit context files
  let fileContents: FileContent[] = [];
  if (options.includeFileContents) {
    const filesToFetch = new Set([
      ...reviewedFiles,
      ...options.contextFiles,
    ]);
    fileContents = await fetchFileContents(
      octokit,
      owner,
      repo,
      pr.head.ref,
      filesToFetch,
      options.maxFileSize,
      options.redactSecrets,
    );
    core.info(
      `Fetched ${fileContents.length} file(s) for full context (${fileContents.filter((f) => f.truncated).length} truncated)`,
    );
  }

  return {
    number: prNumber,
    title: pr.title,
    body: pr.body ?? '',
    diff: diffText,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    author: pr.user?.login ?? 'unknown',
    changedFiles: allFiles,
    reviewedFiles,
    ignoredFiles,
    redactionCount,
    fileContents,
  };
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

/**
 * Truncate a diff at file boundaries instead of cutting mid-file.
 * Prioritizes source code files over tests and configs/docs.
 * Priority: 2 = source code, 1 = test files, 0 = configs/docs.
 */
function smartTruncateDiff(diff: string, maxSize: number): string {
  const chunks = diff.split(/(?=^diff --git )/m);
  const codeExts = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
    '.rb', '.php', '.cs', '.c', '.cpp', '.h', '.swift', '.kt',
  ]);

  const scored = chunks
    .filter((c) => c.startsWith('diff --git '))
    .map((chunk) => {
      const fileMatch = chunk.match(/^diff --git a\/.+? b\/(.+)$/m);
      const filename = fileMatch?.[1] ?? '';
      const ext = filename.slice(filename.lastIndexOf('.'));
      const isTest = isTestFile(filename);
      let priority = 0;
      if (codeExts.has(ext)) {
        priority = isTest ? 1 : 2;
      }
      return { chunk, filename, priority };
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
    result += `\n\n... [${skipped.length} file(s) truncated: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}] ...`;
  }
  return result;
}

// ─── File content fetching ──────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.br',
  '.mp3', '.mp4', '.mov', '.avi',
  '.wasm', '.pyc', '.class', '.o', '.so', '.dll',
]);

const FETCH_CONCURRENCY = 10;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function fetchFileContents(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  ref: string,
  files: Set<string>,
  maxFileSize: number,
  redactSecretsEnabled: boolean,
): Promise<FileContent[]> {
  const results: FileContent[] = [];

  const filePaths = [...files].filter((filePath) => {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    return !BINARY_EXTENSIONS.has(ext.toLowerCase());
  });

  await runWithConcurrency(filePaths, FETCH_CONCURRENCY, async (filePath) => {
    try {
      const data = await ghRequest(
        () => octokit.rest.repos.getContent({ owner, repo, path: filePath, ref }) as Promise<{ data: { type?: string; content?: string }; headers: Record<string, string | undefined> }>,
        `getContent(${filePath})`,
      );

      if (!data.content || data.type !== 'file') return;

      let content = Buffer.from(data.content, 'base64').toString('utf-8');
      let truncated = false;

      if (content.length > maxFileSize) {
        content = content.slice(0, maxFileSize) + '\n// ... [file truncated] ...';
        truncated = true;
      }

      if (redactSecretsEnabled) {
        const { redactSecrets } = await import('./redact');
        content = redactSecrets(content);
      }

      results.push({ path: filePath, content, truncated });
    } catch {
      // File might not exist on the head branch (deleted file) — skip
    }
  });

  return results;
}

// ─── Comment posting ────────────────────────────────────────────────

export async function postReviewComment(
  token: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const marker = '<!-- ai-pr-reviewer -->';
  let fullBody = `${marker}\n${body}`;

  if (fullBody.length > 65536) {
    core.warning('Review comment exceeds GitHub limit; truncating body.');
    fullBody =
      fullBody.slice(0, 65000) +
      '\n\n... [review truncated — see workflow logs] ...';
  }

  await upsertComment(octokit, owner, repo, prNumber, marker, fullBody);
}

async function upsertComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string,
  body: string,
): Promise<void> {
  let existing: { id: number } | undefined;
  let page = 1;

  while (!existing) {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    });

    existing = comments.find((c) => c.body?.includes(marker));
    if (existing || comments.length < 100) break;
    page++;
  }

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing review comment #${existing.id}`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info('Posted new review comment');
  }
}

// ─── Inline review comments ────────────────────────────────────────

function findNearestValidLine(
  targetLine: number,
  validLines: Set<number>,
): number | undefined {
  if (validLines.size === 0) return undefined;
  let nearest: number | undefined;
  let minDist = Infinity;
  for (const line of validLines) {
    const dist = Math.abs(line - targetLine);
    if (dist < minDist) {
      minDist = dist;
      nearest = line;
    }
  }
  return nearest;
}

export async function postInlineReview(
  token: string,
  prNumber: number,
  diff: string,
  findings: Finding[],
): Promise<{ posted: number; skipped: number }> {
  const findingsWithLocation = findings.filter((f) => f.file && f.line);
  if (findingsWithLocation.length === 0) {
    return { posted: 0, skipped: 0 };
  }

  const validTargets = parseDiffForCommentTargets(diff);

  const comments: Array<{ path: string; line: number; body: string }> = [];
  let skipped = 0;

  for (const finding of findingsWithLocation) {
    const fileTargets = validTargets.get(finding.file!);
    if (!fileTargets || fileTargets.size === 0) {
      skipped++;
      continue;
    }

    let line = finding.line!;
    let relocated = false;

    if (!fileTargets.has(line)) {
      const nearest = findNearestValidLine(line, fileTargets);
      if (!nearest) {
        skipped++;
        continue;
      }
      line = nearest;
      relocated = true;
    }

    const icon =
      finding.severity === 'critical'
        ? '🔴'
        : finding.severity === 'warning'
          ? '🟡'
          : '🔵';

    let body = `${icon} **${finding.severity.toUpperCase()}** — ${finding.message}`;
    if (relocated) {
      body = `📍 *Refers to line ${finding.line}*\n\n${body}`;
    }

    comments.push({ path: finding.file!, line, body });
  }

  if (comments.length === 0) {
    return { posted: 0, skipped };
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const existingBotComments = await listExistingBotReviewComments(
    octokit, owner, repo, prNumber,
  );
  const newComments = comments.filter(
    (c) => !existingBotComments.has(`${c.path}:${c.line}:${c.body}`),
  );

  if (newComments.length === 0) {
    core.info('All inline findings already posted — skipping duplicates.');
    return { posted: 0, skipped };
  }

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: 'COMMENT',
      body: `🤖 AI PR Reviewer — ${newComments.length} inline finding(s)`,
      comments: newComments.map((c) => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT' as const,
        body: c.body,
      })),
    });
    core.info(`Posted ${newComments.length} inline review comment(s) (${comments.length - newComments.length} duplicates skipped)`);
    return { posted: newComments.length, skipped };
  } catch (batchErr: unknown) {
    const batchMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
    core.warning(`Batch inline review failed (${batchMsg}). Falling back to individual comments.`);

    const { data: prData } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    const commitId = prData.head.sha;

    let posted = 0;
    for (const c of newComments) {
      try {
        await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          path: c.path,
          line: c.line,
          side: 'RIGHT',
          body: c.body,
          commit_id: commitId,
        });
        posted++;
      } catch {
        skipped++;
        core.debug(`Skipped inline comment on ${c.path}:${c.line} (line not in diff)`);
      }
    }

    core.info(`Posted ${posted} inline comment(s) individually (${skipped} skipped)`);
    return { posted, skipped };
  }
}

async function listExistingBotReviewComments(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let page = 1;

  while (true) {
    const { data: comments } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });

    for (const c of comments) {
      if (c.body?.includes('**CRITICAL**') || c.body?.includes('**WARNING**') || c.body?.includes('**SUGGESTION**')) {
        const line = c.line ?? c.original_line ?? 0;
        keys.add(`${c.path}:${line}:${c.body}`);
      }
    }

    if (comments.length < 100) break;
    page++;
  }

  return keys;
}
