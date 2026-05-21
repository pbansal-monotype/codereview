import * as core from '@actions/core';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { getPullRequestData, postReviewComment, postInlineReview } from './github';
import { runReview } from './review';
import { sanitizeErrorMessage } from './sanitize';

const MAX_OUTPUT_BYTES = 900_000; // GitHub Actions output limit is ~1MB

async function main(): Promise<void> {
  try {
    core.info('AI PR Reviewer starting...');

    const config = loadConfig();
    core.info(`Provider: ${config.provider} | Model: ${config.model}`);

    const provider = createProvider(config.provider, config.apiKey, config.model);

    core.info('Fetching PR data...');
    const pr = await getPullRequestData(config.githubToken, {
      maxDiffSize: config.maxDiffSize,
      ignorePatterns: config.ignorePatterns,
      redactSecrets: config.redactSecrets,
    });
    core.info(
      `PR #${pr.number}: "${pr.title}" (${pr.reviewedFiles.length} files to review)`,
    );

    const result = await runReview(provider, config, pr);

    // Truncate output to stay under GitHub Actions 1MB limit
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

    if (config.postReviewComment) {
      core.info('Posting review comment...');
      await postReviewComment(config.githubToken, pr.number, result.markdown);
    }

    if (config.postInlineComments && result.structured?.findings.length) {
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

    if (result.hasCritical && config.failOnCritical) {
      core.setFailed(
        'Critical issues found in PR review. See the review comment for details.',
      );
    } else {
      core.info('Review complete.');
    }
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI PR Reviewer failed: ${sanitizeErrorMessage(raw)}`);
  }
}

main();
