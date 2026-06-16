import * as core from '@actions/core';
import { ReviewConfig } from '../config';
import { parseStructuredReview, StructuredReview } from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult, TokenUsage } from './types';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from './prompts';

interface JudgeResult {
  structured: StructuredReview;
  tokens: TokenUsage;
}

export async function runJudge(
  provider: AIProvider,
  specialistResults: SpecialistResult[],
  pr: PullRequestData,
  config: ReviewConfig,
  sharedContext: string,
  enabledCategories: string[],
): Promise<JudgeResult> {
  core.info('[judge] Starting quality gate review...');

  const systemPrompt = buildJudgeSystemPrompt(config, enabledCategories);
  const userPrompt = buildJudgeUserPrompt(specialistResults, pr, sharedContext);

  const response = await provider.review({
    systemPrompt,
    userPrompt,
    timeoutMs: config.timeoutMs,
  });

  // Attempt to parse the judge output. On first failure, retry the LLM call once
  // before failing closed — parse errors are often transient formatting issues.
  let structured: StructuredReview | undefined;
  let parseError: unknown;

  try {
    structured = response.structured ?? parseStructuredReview(response.review);
  } catch (err) {
    parseError = err;
    core.warning('[judge] Failed to parse judge output on first attempt — retrying once...');
  }

  if (!structured) {
    // One retry: re-issue the same prompt.
    const retry = await provider.review({
      systemPrompt,
      userPrompt,
      timeoutMs: config.timeoutMs,
    });
    try {
      structured = retry.structured ?? parseStructuredReview(retry.review);
      // Merge token counts from both calls.
      response.inputTokens += retry.inputTokens;
      response.outputTokens += retry.outputTokens;
      response.tokensUsed += retry.tokensUsed;
    } catch (retryErr) {
      // Both attempts failed — re-throw so the orchestrator's fail-closed path fires.
      const msg =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      core.error(
        `[judge] Judge output unparseable after retry (original: ${String(parseError)}; retry: ${msg}) — failing closed`,
      );
      throw retryErr;
    }
  }

  core.info(
    `[judge] Approved ${structured.findings.length} finding(s) (${response.tokensUsed} tokens)`,
  );

  return {
    structured,
    tokens: { input: response.inputTokens, output: response.outputTokens },
  };
}
