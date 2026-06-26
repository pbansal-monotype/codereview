import * as core from '@actions/core';
import { getOctokit, getRepoContext } from './client';

export const FINDING_MARKER_RE = /<!-- ai-pr-finding:\s*(.+?)\s*-->/;
export const DISMISS_MARKER_RE = /<!-- ai-pr-dismiss:\s*(.+?)\s*-->/;
export const DISMISS_REPLY_RE = /^\s*(\/dismiss|dismiss|won'?t\s*fix|ignore)\s*$/i;

/**
 * Collect finding fingerprints dismissed via:
 * - `<!-- ai-pr-dismiss: fingerprint -->` in PR issue comments
 * - `/dismiss` (or dismiss / won't fix / ignore) replies on inline review threads
 */
export async function collectDismissedFingerprints(
  token: string,
  prNumber: number,
): Promise<Set<string>> {
  const octokit = getOctokit(token);
  const { owner, repo } = getRepoContext();
  const dismissed = new Set<string>();

  await collectDismissMarkersFromIssueComments(octokit, owner, repo, prNumber, dismissed);
  await collectDismissRepliesOnReviewComments(octokit, owner, repo, prNumber, dismissed);

  if (dismissed.size > 0) {
    core.info(
      `[dismiss] ${dismissed.size} dismissed finding fingerprint(s) from PR comments`,
    );
  }

  return dismissed;
}

async function collectDismissMarkersFromIssueComments(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  dismissed: Set<string>,
): Promise<void> {
  let page = 1;

  while (true) {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    });

    for (const c of comments) {
      if (!c.body) continue;
      for (const match of c.body.matchAll(new RegExp(DISMISS_MARKER_RE, 'g'))) {
        dismissed.add(match[1]);
      }
    }

    if (comments.length < 100) break;
    page++;
  }
}

async function collectDismissRepliesOnReviewComments(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  dismissed: Set<string>,
): Promise<void> {
  const comments: Array<{
    id: number;
    body?: string | null;
    in_reply_to_id?: number | null;
  }> = [];

  let page = 1;
  while (true) {
    const { data } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    comments.push(...data);
    if (data.length < 100) break;
    page++;
  }

  for (const comment of comments) {
    if (!comment.body || !FINDING_MARKER_RE.test(comment.body)) continue;
    const fpMatch = comment.body.match(FINDING_MARKER_RE);
    if (!fpMatch) continue;
    const fingerprint = fpMatch[1];

    for (const reply of comments) {
      if (reply.in_reply_to_id !== comment.id || !reply.body) continue;
      if (DISMISS_REPLY_RE.test(reply.body.trim())) {
        dismissed.add(fingerprint);
        core.info(`[dismiss] Fingerprint dismissed via reply on ${comment.id}`);
      }
      const marker = reply.body.match(DISMISS_MARKER_RE);
      if (marker && marker[1] === fingerprint) {
        dismissed.add(fingerprint);
      }
    }
  }
}
