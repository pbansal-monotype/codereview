import * as core from '@actions/core';
import * as github from '@actions/github';
import { shouldIgnoreFile } from '../context/ignore';
import { prepareDiffForReview } from '../context/diff';
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

function partitionFiles(
  allFiles: string[],
  ignorePatterns: string[],
): { reviewedFiles: string[]; ignoredFiles: string[] } {
  const ignoredFiles = allFiles.filter((f) => shouldIgnoreFile(f, ignorePatterns));
  const reviewedFiles = allFiles.filter((f) => !shouldIgnoreFile(f, ignorePatterns));
  return { reviewedFiles, ignoredFiles };
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

  const { data: rawDiff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });

  const allFiles = await listAllChangedFiles(octokit, owner, repo, prNumber);
  const { reviewedFiles, ignoredFiles } = partitionFiles(allFiles, options.ignorePatterns);

  if (ignoredFiles.length > 0) {
    core.info(
      `Skipping ${ignoredFiles.length} ignored file(s): ${ignoredFiles.slice(0, 10).join(', ')}${ignoredFiles.length > 10 ? '...' : ''}`,
    );
  }

  const { diff, redactionCount } = await prepareDiffForReview(
    rawDiff as unknown as string,
    new Set(ignoredFiles),
    { maxDiffSize: options.maxDiffSize, redactSecrets: options.redactSecrets },
  );

  if (reviewedFiles.length === 0) {
    core.warning('No reviewable files after applying ignore patterns.');
  }

  let fileContents: PullRequestData['fileContents'] = [];
  if (options.includeFileContents) {
    const filesToFetch = new Set([...reviewedFiles, ...options.contextFiles]);
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
      `Fetched ${fileContents.length} file(s) for full context ` +
        `(${fileContents.filter((f) => f.truncated).length} truncated)`,
    );
  }

  return {
    number: prNumber,
    title: pr.title,
    body: pr.body ?? '',
    diff,
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
