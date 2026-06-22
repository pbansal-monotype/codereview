import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { getPullRequestData, postReviewComment, postInlineReview } from './github';
import { runReview } from './agents';
import { sanitizeErrorMessage } from './sanitize';
import { createStateStore } from './state';

const MAX_OUTPUT_BYTES = 900_000;

async function main(): Promise<void> {
  try {
    core.info('AI PR Reviewer starting...');

    const config = loadConfig();
    core.info(`Provider: ${config.provider} | Model: ${config.model}`);

    const provider = createProvider(config.provider, config.apiKey, config.model, config.azureEndpoint);

    // ── State: read last_reviewed_sha ────────────────────────────
    const { owner, repo } = github.context.repo;
    const fullRepo = `${owner}/${repo}`;
    const prNumber = github.context.payload.pull_request?.number;

    const stateStore = config.incrementalReview
      ? createStateStore(config.stateStore, config.githubToken, config.stateGistId)
      : null;

    let lastReviewedSha: string | undefined;
    if (stateStore && prNumber) {
      const prevState = await stateStore.get(fullRepo, prNumber);
      if (prevState) {
        lastReviewedSha = prevState.lastReviewedSha;
        core.info(
          `Previous review state found: sha=${lastReviewedSha.slice(0, 7)}, ` +
          `review #${prevState.reviewCount} at ${prevState.lastReviewedAt}`,
        );
      } else {
        core.info('No previous review state — first review for this PR.');
      }
    }

    core.info('Fetching PR data...');
    const pr = await getPullRequestData(config.githubToken, {
      ignorePatterns: config.ignorePatterns,
      lastReviewedSha: config.incrementalReview ? lastReviewedSha : undefined,
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

    const result = await runReview(provider, config, pr);

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

    // Always post review comment
    core.info('Posting review comment...');
    let commentBody = result.markdown;
    if (config.stateStore === 'comment-marker') {
      const stateJson = JSON.stringify({
        lastReviewedSha: pr.headSha,
        lastReviewedAt: new Date().toISOString(),
        reviewCount: (stateStore ? ((await stateStore.get(fullRepo, pr.number))?.reviewCount ?? 0) : 0) + 1,
      });
      commentBody += `\n<!-- ai-pr-reviewer-state: ${stateJson} -->`;
    }
    await postReviewComment(config.githubToken, pr.number, commentBody);

    // Always post inline comments when findings exist
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

    // ── State: persist last_reviewed_sha after successful review ──
    if (stateStore && config.stateStore === 'gist') {
      const prevState = await stateStore.get(fullRepo, pr.number);
      await stateStore.set(fullRepo, pr.number, {
        lastReviewedSha: pr.headSha,
        lastReviewedAt: new Date().toISOString(),
        reviewCount: (prevState?.reviewCount ?? 0) + 1,
      });
    }

    core.info('Review complete.');
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI PR Reviewer failed: ${sanitizeErrorMessage(raw)}`);
  }
}

main();
