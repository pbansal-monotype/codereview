import * as core from '@actions/core';
import { getOctokit } from '../github/client';
import type { Octokit } from '../github/client';
import type { StoredFinding } from './findings-state';

export interface ReviewState {
  lastReviewedSha: string;
  lastReviewedAt: string;
  reviewCount: number;
  /** Findings from the last successful review (for same-commit reuse and suppression). */
  storedFindings?: StoredFinding[];
  /** Fingerprints dismissed via PR comments or inline /dismiss replies. */
  dismissedFingerprints?: string[];
}

export interface StateStore {
  get(repo: string, prNumber: number): Promise<ReviewState | null>;
  set(repo: string, prNumber: number, state: ReviewState): Promise<void>;
}

// ─── GitHub Gist-backed store ────────────────────────────────────

const STATE_FILE_PREFIX = 'ai-pr-reviewer-state-';

function stateFileName(repo: string, prNumber: number): string {
  const safeRepo = repo.replace(/\//g, '-');
  return `${STATE_FILE_PREFIX}${safeRepo}-${prNumber}.json`;
}

export class GistStateStore implements StateStore {
  private octokit: Octokit;
  private gistId: string;

  constructor(token: string, gistId: string) {
    this.octokit = getOctokit(token);
    this.gistId = gistId;
  }

  async get(repo: string, prNumber: number): Promise<ReviewState | null> {
    const filename = stateFileName(repo, prNumber);

    try {
      const { data: gist } = await this.octokit.rest.gists.get({
        gist_id: this.gistId,
      });

      const file = gist.files?.[filename];
      if (!file?.content) return null;

      return JSON.parse(file.content) as ReviewState;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        core.warning(`State gist ${this.gistId} not found. Starting fresh.`);
        return null;
      }
      core.warning(`Failed to read state from gist: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async set(repo: string, prNumber: number, state: ReviewState): Promise<void> {
    const filename = stateFileName(repo, prNumber);

    try {
      await this.octokit.rest.gists.update({
        gist_id: this.gistId,
        files: {
          [filename]: {
            content: JSON.stringify(state, null, 2),
          },
        },
      });
      core.info(`State persisted to gist for PR #${prNumber} (sha: ${state.lastReviewedSha})`);
    } catch (err: unknown) {
      core.warning(`Failed to persist state to gist: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

// ─── GitHub Actions artifact-based store (no external Gist needed) ──

export class CommitStatusStore implements StateStore {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = getOctokit(token);
  }

  async get(repo: string, prNumber: number): Promise<ReviewState | null> {
    const [owner, repoName] = repo.split('/');

    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner,
        repo: repoName,
        issue_number: prNumber,
        per_page: 100,
      });

      for (let i = comments.length - 1; i >= 0; i--) {
        const body = comments[i].body;
        if (!body) continue;
        const match = body.match(
          /<!-- ai-pr-reviewer-state: ({.*?}) -->/s,
        );
        if (match) {
          return JSON.parse(match[1]) as ReviewState;
        }
      }
      return null;
    } catch (err: unknown) {
      core.warning(`Failed to read state from PR comments: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async set(repo: string, prNumber: number, state: ReviewState): Promise<void> {
    core.info(`State marker for PR #${prNumber}: sha=${state.lastReviewedSha}, review #${state.reviewCount}`);
  }
}

// ─── Factory ──────────────────────────────────────────────────────

export type StoreType = 'gist' | 'comment-marker' | 'none';

export function createStateStore(
  type: StoreType,
  token: string,
  gistId?: string,
): StateStore | null {
  switch (type) {
    case 'gist':
      if (!gistId) {
        throw new Error('state_store=gist requires state_gist_id to be set.');
      }
      return new GistStateStore(token, gistId);
    case 'comment-marker':
      return new CommitStatusStore(token);
    case 'none':
      return null;
    default:
      core.warning(`Unknown state store type "${type}". Falling back to no state.`);
      return null;
  }
}
