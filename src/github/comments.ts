import * as core from '@actions/core';
import { parseDiffForCommentTargets } from '../context/diff';
import type { Finding } from '../output/findings';
import { getOctokit, getRepoContext } from './client';
import type { Octokit } from './client';

const REVIEW_COMMENT_MARKER = '<!-- ai-pr-reviewer -->';
const MAX_COMMENT_BODY = 65536;

// ─── PR summary comment ─────────────────────────────────────────────

export async function postReviewComment(
  token: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const octokit = getOctokit(token);
  const { owner, repo } = getRepoContext();

  let fullBody = `${REVIEW_COMMENT_MARKER}\n${body}`;
  if (fullBody.length > MAX_COMMENT_BODY) {
    core.warning('Review comment exceeds GitHub limit; truncating body.');
    fullBody =
      fullBody.slice(0, 65000) +
      '\n\n... [review truncated — see workflow logs] ...';
  }

  await upsertComment(octokit, owner, repo, prNumber, REVIEW_COMMENT_MARKER, fullBody);
}

async function upsertComment(
  octokit: Octokit,
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

// ─── Inline review comments ─────────────────────────────────────────

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

function formatInlineCommentBody(
  finding: Finding,
  relocated: boolean,
): string {
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
  return body;
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

    comments.push({
      path: finding.file!,
      line,
      body: formatInlineCommentBody(finding, relocated),
    });
  }

  if (comments.length === 0) {
    return { posted: 0, skipped };
  }

  const octokit = getOctokit(token);
  const { owner, repo } = getRepoContext();

  const existingBotComments = await listExistingBotReviewComments(
    octokit,
    owner,
    repo,
    prNumber,
  );
  const newComments = comments.filter(
    (c) => !existingBotComments.has(`${c.path}:${c.line}:${c.body}`),
  );

  if (newComments.length === 0) {
    core.info('All inline findings already posted — skipping duplicates.');
    return { posted: 0, skipped };
  }

  return postInlineComments(octokit, owner, repo, prNumber, newComments, comments, skipped);
}

async function postInlineComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  newComments: Array<{ path: string; line: number; body: string }>,
  allComments: Array<{ path: string; line: number; body: string }>,
  skipped: number,
): Promise<{ posted: number; skipped: number }> {
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
    core.info(
      `Posted ${newComments.length} inline review comment(s) ` +
        `(${allComments.length - newComments.length} duplicates skipped)`,
    );
    return { posted: newComments.length, skipped };
  } catch (batchErr: unknown) {
    const batchMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
    core.warning(`Batch inline review failed (${batchMsg}). Falling back to individual comments.`);

    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
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
  octokit: Octokit,
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
      if (
        c.body?.includes('**CRITICAL**') ||
        c.body?.includes('**WARNING**') ||
        c.body?.includes('**SUGGESTION**')
      ) {
        const line = c.line ?? c.original_line ?? 0;
        keys.add(`${c.path}:${line}:${c.body}`);
      }
    }

    if (comments.length < 100) break;
    page++;
  }

  return keys;
}
