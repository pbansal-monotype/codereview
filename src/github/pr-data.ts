import * as core from '@actions/core';
import * as github from '@actions/github';
import { isAllowedFile, shouldIgnoreFile } from '../filter';
import { prepareDiffForReview } from '../context/diff';
import { MAX_FILE_SIZE } from '../config';
import { getOctokit } from './client';
import { fetchFileContents } from './file-contents';
import type { FetchPROptions, PullRequestData } from './types';

async function listAllChangedFiles(
  octokit: ReturnType<typeof getOctokit>,
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

export interface FilePartition {
  reviewedFiles: string[];
  /** Every excluded file, whatever the reason — callers strip these from the diff. */
  ignoredFiles: string[];
  /** Subset of ignoredFiles rejected by the extension allowlist rather than an ignore pattern. */
  disallowedFiles: string[];
}

export function partitionFiles(allFiles: string[], ignorePatterns: string[]): FilePartition {
  const reviewedFiles: string[] = [];
  const ignoredFiles: string[] = [];
  const disallowedFiles: string[] = [];

  for (const file of allFiles) {
    if (!isAllowedFile(file)) {
      disallowedFiles.push(file);
      ignoredFiles.push(file);
    } else if (shouldIgnoreFile(file, ignorePatterns)) {
      ignoredFiles.push(file);
    } else {
      reviewedFiles.push(file);
    }
  }

  return { reviewedFiles, ignoredFiles, disallowedFiles };
}

function preview(files: string[], limit = 10): string {
  return `${files.slice(0, limit).join(', ')}${files.length > limit ? '...' : ''}`;
}

/**
 * Fetch the incremental diff between two commits using the compare API.
 * Returns the diff string and the list of files changed in that range.
 */
async function fetchIncrementalDiff(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<{ diff: string; changedFiles: string[] }> {
  const { data: comparison } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${baseSha}...${headSha}`,
    mediaType: { format: 'diff' },
  });

  const diffText = comparison as unknown as string;

  const { data: comparisonJson } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${baseSha}...${headSha}`,
  });

  const changedFiles = (comparisonJson.files ?? []).map((f) => f.filename);

  return { diff: diffText, changedFiles };
}

/**
 * Validate that a SHA exists in the repo (the old reviewed commit hasn't
 * been force-pushed away). Returns true if the commit is reachable.
 */
async function isCommitReachable(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  sha: string,
): Promise<boolean> {
  try {
    await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
    return true;
  } catch {
    return false;
  }
}

export async function getPullRequestData(
  token: string,
  options: FetchPROptions,
): Promise<PullRequestData> {
  const octokit = getOctokit(token);
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

  const headSha = pr.head.sha;
  let isIncremental = false;
  let incrementalBaseSha: string | undefined;
  let rawDiff: string;
  let allFiles: string[];

  // Attempt incremental diff if we have a previous review SHA
  if (options.lastReviewedSha && options.lastReviewedSha !== headSha) {
    const reachable = await isCommitReachable(octokit, owner, repo, options.lastReviewedSha);

    if (reachable) {
      core.info(
        `Incremental review: diffing ${options.lastReviewedSha.slice(0, 7)}..${headSha.slice(0, 7)}`,
      );
      const incremental = await fetchIncrementalDiff(
        octokit, owner, repo, options.lastReviewedSha, headSha,
      );
      rawDiff = incremental.diff;
      allFiles = incremental.changedFiles;
      isIncremental = true;
      incrementalBaseSha = options.lastReviewedSha;
    } else {
      core.warning(
        `Previous review SHA ${options.lastReviewedSha.slice(0, 7)} is no longer reachable ` +
        `(force-push?). Falling back to full PR diff.`,
      );
      const { data: fullDiff } = await octokit.rest.pulls.get({
        owner, repo, pull_number: prNumber,
        mediaType: { format: 'diff' },
      });
      rawDiff = fullDiff as unknown as string;
      allFiles = await listAllChangedFiles(octokit, owner, repo, prNumber);
    }
  } else {
    // No previous state or same SHA — full PR diff
    const { data: fullDiff } = await octokit.rest.pulls.get({
      owner, repo, pull_number: prNumber,
      mediaType: { format: 'diff' },
    });
    rawDiff = fullDiff as unknown as string;
    allFiles = await listAllChangedFiles(octokit, owner, repo, prNumber);
  }

  const { reviewedFiles, ignoredFiles, disallowedFiles } = partitionFiles(
    allFiles,
    options.ignorePatterns,
  );

  const disallowedSet = new Set(disallowedFiles);
  const patternIgnored = ignoredFiles.filter((f) => !disallowedSet.has(f));
  if (patternIgnored.length > 0) {
    core.info(`Skipping ${patternIgnored.length} ignored file(s): ${preview(patternIgnored)}`);
  }
  if (disallowedFiles.length > 0) {
    core.info(
      `Skipping ${disallowedFiles.length} file(s) with unsupported extensions: ` +
        `${preview(disallowedFiles)}. Add the extension to ALLOWED_EXTENSIONS to review these.`,
    );
  }

  const { diff, redactionCount } = await prepareDiffForReview(
    rawDiff,
    new Set(ignoredFiles),
    { redactSecrets: true },
  );

  if (reviewedFiles.length === 0) {
    core.warning('No reviewable files after applying the extension allowlist and ignore patterns.');
  }

  const filesToFetch = new Set(reviewedFiles);
  const fileContents = await fetchFileContents(
    octokit,
    owner,
    repo,
    pr.head.ref,
    filesToFetch,
    MAX_FILE_SIZE,
    true,
  );
  core.info(
    `Fetched ${fileContents.length} file(s) for full context ` +
      `(${fileContents.filter((f) => f.truncated).length} truncated)`,
  );

  return {
    number: prNumber,
    title: pr.title,
    body: pr.body ?? '',
    diff,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha,
    author: pr.user?.login ?? 'unknown',
    changedFiles: allFiles,
    reviewedFiles,
    ignoredFiles,
    redactionCount,
    fileContents,
    isIncremental,
    incrementalBaseSha,
  };
}
