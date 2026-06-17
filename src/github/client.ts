import * as core from '@actions/core';
import * as github from '@actions/github';

const RATE_LIMIT_WARN_THRESHOLD = 100;

export type Octokit = ReturnType<typeof github.getOctokit>;

export function getOctokit(token: string): Octokit {
  return github.getOctokit(token);
}

export function getRepoContext(): { owner: string; repo: string } {
  return github.context.repo;
}

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

export async function ghRequest<T>(
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
