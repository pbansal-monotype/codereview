import * as core from '@actions/core';
import { ReviewConfig } from '../config';
import {
  parseStructuredReview,
  parseDedupedFindings,
  StructuredReview,
} from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult, TokenUsage } from './types';
import {
  buildJudgeDedupSystemPrompt,
  buildJudgeDedupUserPrompt,
  buildJudgeRewriteSystemPrompt,
  buildJudgeRewriteUserPrompt,
  collectSpecialistFindings,
} from './prompts';

interface JudgeResult {
  structured: StructuredReview;

  tokens: TokenUsage;
}

interface AgentCallResult<T> {
  value: T;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}

async function callWithParseRetry<T>(
  label: string,
  provider: AIProvider,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  parse: (raw: string) => T,
): Promise<AgentCallResult<T>> {
  const response = await provider.review({ systemPrompt, userPrompt, timeoutMs });

  core.debug(`[${label}] SYSTEM PROMPT (${systemPrompt.length} chars):\n${systemPrompt}`);
  core.debug(`[${label}] USER PROMPT (${userPrompt.length} chars):\n${userPrompt}`);

  try {
    const value = parse(response.review);
    core.debug(`[${label}] RAW RESPONSE:\n${response.review}`);
    return {
      value,
      tokensUsed: response.tokensUsed,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  } catch (err) {
    core.warning(`[${label}] Failed to parse output on first attempt — retrying once...`);
    core.debug(`[${label}] RAW RESPONSE (unparseable):\n${response.review}`);

    const retry = await provider.review({ systemPrompt, userPrompt, timeoutMs });
    try {
      const value = parse(retry.review);
      core.debug(`[${label}] RAW RESPONSE (retry):\n${retry.review}`);
      return {
        value,
        tokensUsed: response.tokensUsed + retry.tokensUsed,
        inputTokens: response.inputTokens + retry.inputTokens,
        outputTokens: response.outputTokens + retry.outputTokens,
      };
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      const original = err instanceof Error ? err.message : String(err);
      core.error(
        `[${label}] Output unparseable after retry (original: ${original}; retry: ${msg}) — failing closed`,
      );
      throw retryErr;
    }
  }
}

export async function runJudge(
  provider: AIProvider,
  specialistResults: SpecialistResult[],
  pr: PullRequestData,
  config: ReviewConfig,
  _sharedContext: string,
  _enabledCategories: string[],
): Promise<JudgeResult> {
  const allFindings = collectSpecialistFindings(specialistResults);

  core.info(`[judge/dedup] Deduplicating ${allFindings.length} raw finding(s)...`);

  const dedupResult = await callWithParseRetry(
    'judge/dedup',
    provider,
    buildJudgeDedupSystemPrompt(config),
    buildJudgeDedupUserPrompt(allFindings),
    config.timeoutMs,
    parseDedupedFindings,
  );

  core.info(
    `[judge/dedup] ${dedupResult.value.length} finding(s) after dedup (${dedupResult.tokensUsed} tokens)`,
  );

  core.info('[judge/rewrite] Rewriting finding messages and writing summary...');

  const rewriteResult = await callWithParseRetry(
    'judge/rewrite',
    provider,
    buildJudgeRewriteSystemPrompt(config),
    buildJudgeRewriteUserPrompt(dedupResult.value, pr),
    config.timeoutMs,
    parseStructuredReview,
  );

  const structured = rewriteResult.value;

  const totalTokens =
    dedupResult.tokensUsed + rewriteResult.tokensUsed;
  const inputTokens = dedupResult.inputTokens + rewriteResult.inputTokens;
  const outputTokens = dedupResult.outputTokens + rewriteResult.outputTokens;

  core.info(
    `[judge/rewrite] Final output: ${structured.findings.length} finding(s) (${rewriteResult.tokensUsed} tokens; ${totalTokens} total judge tokens)`,
  );

  return {
    structured,
    tokens: { input: inputTokens, output: outputTokens },
  };
}
