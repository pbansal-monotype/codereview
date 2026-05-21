import * as core from '@actions/core';
import * as github from '@actions/github';
import { filterDiffByFiles, shouldIgnoreFile } from './ignore';
import { parseDiffForCommentTargets } from './diff-parser';
import { Finding } from './findings';

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

/**
 * Truncate a diff at file boundaries instead of cutting mid-file.
 * Prioritizes source code files over configs/docs.
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
      const priority = codeExts.has(ext) ? 1 : 0;
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

  for (const filePath of files) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (BINARY_EXTENSIONS.has(ext.toLowerCase())) continue;

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref,
      });

      if (!('content' in data) || data.type !== 'file') continue;

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
  }

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
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(marker));

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
    if (!fileTargets || !fileTargets.has(finding.line!)) {
      skipped++;
      continue;
    }

    const icon =
      finding.severity === 'critical'
        ? '🔴'
        : finding.severity === 'warning'
          ? '🟡'
          : '🔵';

    comments.push({
      path: finding.file!,
      line: finding.line!,
      body: `${icon} **${finding.severity.toUpperCase()}** — ${finding.message}`,
    });
  }

  if (comments.length === 0) {
    return { posted: 0, skipped };
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: 'COMMENT',
      body: `🤖 AI PR Reviewer — ${comments.length} inline finding(s)`,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    });
    core.info(`Posted ${comments.length} inline review comment(s)`);
    return { posted: comments.length, skipped };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`Failed to post inline review (falling back to summary): ${msg}`);
    return { posted: 0, skipped: skipped + comments.length };
  }
}
