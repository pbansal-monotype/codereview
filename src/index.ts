import * as core from '@actions/core';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { getPullRequestData, postReviewComment } from './github';
import { runReview } from './review';

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

    core.setOutput('review_body', result.markdown);
    core.setOutput('has_critical_issues', result.hasCritical.toString());
    core.setOutput('categories_reviewed', result.categories.join(','));
    core.setOutput('findings_count', String(result.structured?.findings.length ?? 0));

    if (config.postReviewComment) {
      core.info('Posting review comment...');
      await postReviewComment(config.githubToken, pr.number, result.markdown);
    }

    if (result.hasCritical && config.failOnCritical) {
      core.setFailed(
        'Critical issues found in PR review. See the review comment for details.',
      );
    } else {
      core.info('Review complete.');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI PR Reviewer failed: ${message}`);
  }
}

main();
