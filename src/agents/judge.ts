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
): Promise<JudgeResult> {
  core.info('[judge] Starting quality gate review...');

  const systemPrompt = buildJudgeSystemPrompt(config);
  const userPrompt = buildJudgeUserPrompt(specialistResults, pr, sharedContext);

  const response = await provider.review({
    systemPrompt,
    userPrompt,
    timeoutMs: config.timeoutMs,
  });

  let structured: StructuredReview;
  try {
    structured = response.structured ?? parseStructuredReview(response.review);
  } catch {
    core.warning(
      '[judge] Failed to parse judge output — using raw specialist findings',
    );
    const allFindings = specialistResults.flatMap((r) => r.findings);
    structured = {
      summary:
        'Judge review could not parse output. Showing unfiltered specialist findings.',
      findings: allFindings,
    };
  }

  core.info(
    `[judge] Approved ${structured.findings.length} finding(s) (${response.tokensUsed} tokens)`,
  );

  return {
    structured,
    tokens: { input: response.inputTokens, output: response.outputTokens },
  };
}
