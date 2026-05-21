import * as core from '@actions/core';
import * as github from '@actions/github';
import { filterDiffByFiles, shouldIgnoreFile } from './ignore';

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
}

export interface FetchPROptions {
  maxDiffSize: number;
  ignorePatterns: string[];
  redactSecrets: boolean;
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
    core.info(`Skipping ${ignoredFiles.length} ignored file(s): ${ignoredFiles.slice(0, 10).join(', ')}${ignoredFiles.length > 10 ? '...' : ''}`);
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
    diffText =
      diffText.slice(0, options.maxDiffSize) +
      '\n\n... [diff truncated due to size] ...';
  }

  if (reviewedFiles.length === 0) {
    core.warning('No reviewable files after applying ignore patterns.');
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
  };
}

export async function postReviewComment(
  token: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const marker = '<!-- ai-pr-reviewer -->';
  const fullBody = `${marker}\n${body}`;

  if (fullBody.length > 65536) {
    core.warning('Review comment exceeds GitHub limit; truncating body.');
    const truncated =
      fullBody.slice(0, 65000) + '\n\n... [review truncated — see workflow logs] ...';
    await upsertComment(octokit, owner, repo, prNumber, marker, truncated);
    return;
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
