import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadConfig } from './config';
import { createProvider } from './providers';
import {
  getPullRequestData,
  postReviewComment,
  postInlineReview,
  collectDismissedFingerprints,
} from './github';
import { runReview } from './agents';
import { sanitizeErrorMessage } from './sanitize';
import {
  createStateStore,
  fromStoredFindings,
  mergeDismissedFingerprints,
  toStoredFindings,
  type ReviewState,
} from './state';
import {
  buildJudgeReviewFromDedup,
  filterDismissedFindings,
  hasCriticalFindings,
} from './output/findings';
import { formatReviewMarkdown } from './output/format';
import type { ReviewResult } from './agents/types';

const MAX_OUTPUT_BYTES = 900_000;

function buildStatePayload(
  headSha: string,
  reviewCount: number,
  findings: ReturnType<typeof toStoredFindings>,
  dismissedFingerprints: string[],
): ReviewState {
  return {
    lastReviewedSha: headSha,
    lastReviewedAt: new Date().toISOString(),
    reviewCount,
    storedFindings: findings,
    dismissedFingerprints,
  };
}

async function persistState(
  stateStore: NonNullable<ReturnType<typeof createStateStore>>,
  stateStoreType: string,
  fullRepo: string,
  prNumber: number,
  state: ReviewState,
): Promise<void> {
  if (stateStoreType === 'gist') {
    await stateStore.set(fullRepo, prNumber, state);
  }
}

function appendStateMarker(commentBody: string, state: ReviewState): string {
  const stateJson = JSON.stringify(state);
  return `${commentBody}\n<!-- ai-pr-reviewer-state: ${stateJson} -->`;
}

async function main(): Promise<void> {
  try {
    core.info('AI PR Reviewer starting...');

    const config = loadConfig();
    core.info(`Provider: ${config.provider} | Model: ${config.model}`);

    const provider = createProvider(config.provider, config.apiKey, config.model, config.azureEndpoint);

    const { owner, repo } = github.context.repo;
    const fullRepo = `${owner}/${repo}`;
    const prPayload = github.context.payload.pull_request;
    const prNumber = prPayload?.number;
    const headSha = prPayload?.head?.sha;

    if (!prNumber || !headSha) {
      throw new Error('This action can only run on pull_request events with a head SHA.');
    }

    const stateStore = config.incrementalReview
      ? createStateStore(config.stateStore, config.githubToken, config.stateGistId)
      : null;

    let prevState: ReviewState | null = null;
    if (stateStore) {
      prevState = await stateStore.get(fullRepo, prNumber);
      if (prevState) {
        core.info(
          `Previous review state found: sha=${prevState.lastReviewedSha.slice(0, 7)}, ` +
          `review #${prevState.reviewCount} at ${prevState.lastReviewedAt}`,
        );
      } else {
        core.info('No previous review state — first review for this PR.');
      }
    }

    const dismissedFromComments = await collectDismissedFingerprints(
      config.githubToken,
      prNumber,
    );
    const dismissedFingerprints = mergeDismissedFingerprints(
      prevState?.dismissedFingerprints,
      dismissedFromComments,
    );
    const suppression = {
      dismissedFingerprints: new Set(dismissedFingerprints),
      previousFindings: prevState?.storedFindings,
    };

    // Same commit already reviewed — reuse cached findings (avoids re-running LLM on workflow re-triggers).
    if (
      config.incrementalReview &&
      prevState &&
      prevState.lastReviewedSha === headSha
    ) {
      core.info(
        `Commit ${headSha.slice(0, 7)} already reviewed — reusing cached findings ` +
        `(reply /dismiss on inline comments to suppress issues).`,
      );

      const pr = await getPullRequestData(config.githubToken, {
        ignorePatterns: config.ignorePatterns,
      });

      const cachedFindings = filterDismissedFindings(
        fromStoredFindings(prevState.storedFindings ?? []),
        suppression.dismissedFingerprints,
      );
      const structured = buildJudgeReviewFromDedup(cachedFindings);
      const categoryIds = Object.entries(config.categories)
        .filter(([, g]) => g.enabled)
        .map(([id]) => id);

      const markdown = formatReviewMarkdown({
        structured,
        pr,
        config,
        categories: categoryIds,
        totalTokens: { input: 0, output: 0 },
        apiCalls: 0,
        specialistResults: [],
      });

      const reviewCount = (prevState.reviewCount ?? 0) + 1;
      const state = buildStatePayload(
        headSha,
        reviewCount,
        toStoredFindings(cachedFindings),
        dismissedFingerprints,
      );

      core.setOutput('review_body', markdown);
      core.setOutput('has_critical_issues', hasCriticalFindings(structured).toString());
      core.setOutput('categories_reviewed', categoryIds.join(','));
      core.setOutput('findings_count', String(structured.findings.length));

      let commentBody = markdown;
      if (config.stateStore === 'comment-marker') {
        commentBody = appendStateMarker(commentBody, state);
      }
      await postReviewComment(config.githubToken, pr.number, commentBody);

      if (structured.findings.length > 0) {
        await postInlineReview(config.githubToken, pr.number, pr.diff, structured.findings);
      }

      if (stateStore) {
        await persistState(stateStore, config.stateStore, fullRepo, pr.number, state);
      }

      core.info('Review complete (cached).');
      return;
    }

    core.info('Fetching PR data...');
    const pr = await getPullRequestData(config.githubToken, {
      ignorePatterns: config.ignorePatterns,
      lastReviewedSha: config.incrementalReview ? prevState?.lastReviewedSha : undefined,
    });

    if (pr.isIncremental) {
      core.info(
        `Incremental review: ${pr.incrementalBaseSha?.slice(0, 7)}..${pr.headSha.slice(0, 7)} ` +
        `(${pr.reviewedFiles.length} changed files in this push)`,
      );
    } else {
      core.info(
        `Full review: PR #${pr.number}: "${pr.title}" (${pr.reviewedFiles.length} files to review)`,
      );
    }

    if (pr.diff.trim().length === 0 && pr.reviewedFiles.length === 0) {
      core.info('No new changes to review. Skipping.');
      core.setOutput('review_body', '');
      core.setOutput('has_critical_issues', 'false');
      core.setOutput('categories_reviewed', '');
      core.setOutput('findings_count', '0');
      return;
    }

    const result: ReviewResult = await runReview(provider, config, pr, {
      suppression,
    });

    const reviewOutput =
      result.markdown.length > MAX_OUTPUT_BYTES
        ? result.markdown.slice(0, MAX_OUTPUT_BYTES) + '\n[truncated]'
        : result.markdown;

    core.setOutput('review_body', reviewOutput);
    core.setOutput('has_critical_issues', result.hasCritical.toString());
    core.setOutput('categories_reviewed', result.categories.join(','));
    core.setOutput(
      'findings_count',
      String(result.structured?.findings.length ?? 0),
    );

    const reviewCount = (prevState?.reviewCount ?? 0) + 1;
    const storedFindings = toStoredFindings(result.structured?.findings ?? []);
    const state = buildStatePayload(headSha, reviewCount, storedFindings, dismissedFingerprints);

    core.info('Posting review comment...');
    let commentBody = result.markdown;
    if (config.stateStore === 'comment-marker') {
      commentBody = appendStateMarker(commentBody, state);
    }
    await postReviewComment(config.githubToken, pr.number, commentBody);

    if (result.structured?.findings.length) {
      core.info('Posting inline review comments...');
      const { posted, skipped } = await postInlineReview(
        config.githubToken,
        pr.number,
        pr.diff,
        result.structured.findings,
      );
      if (posted > 0 || skipped > 0) {
        core.info(
          `Inline comments: ${posted} posted, ${skipped} skipped (line not in diff)`,
        );
      }
    }

    if (stateStore) {
      await persistState(stateStore, config.stateStore, fullRepo, pr.number, state);
    }

    core.info('Review complete.');
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI PR Reviewer failed: ${sanitizeErrorMessage(raw)}`);
  }
}

main();
