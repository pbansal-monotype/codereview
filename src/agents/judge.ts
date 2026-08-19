import * as core from '@actions/core';
import { ReviewConfig, TIMEOUT_MS } from '../config';
import {
  parseDedupedFindings,
  buildUnverifiedFallback,
  buildJudgeReviewFromDedup,
  mechanicalDedup,
  Finding,
  StructuredReview,
} from '../output/findings';
import { AIProvider } from '../providers';
import { SpecialistResult, TokenUsage } from './types';
import {
  buildJudgeDedupSystemPrompt,
  buildJudgeDedupUserPrompt,
  collectSpecialistFindings,
} from '../config/prompts';

interface JudgeResult {
  structured: StructuredReview;
  tokens: TokenUsage;
  apiCalls: number;
}

/**
 * The judge LLM only earns its cost when findings can actually be merged — i.e.
 * two or more findings land in the same file. With 0–1 findings, or when every
 * finding is in a distinct file, mechanical dedup is equivalent and free.
 */
function judgeCanSkipLLM(findings: Finding[]): boolean {
  if (findings.length <= 1) return true;
  const filesSeen = new Set<string>();
  for (const f of findings) {
    const file = f.file ?? '';
    if (filesSeen.has(file)) return false;
    filesSeen.add(file);
  }
  return true;
}

interface AgentCallSuccess<T> {
  ok: true;
  value: T;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}

interface AgentCallParseFailure {
  ok: false;
  reason: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}

type AgentCallOutcome<T> = AgentCallSuccess<T> | AgentCallParseFailure;

async function callWithParseRetry<T>(
  label: string,
  provider: AIProvider,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  parse: (raw: string) => T,
): Promise<AgentCallOutcome<T>> {
  const systemPromptBlocks = [{ text: systemPrompt, ephemeralCache: true }];
  const response = await provider.review({
    systemPrompt,
    systemPromptBlocks,
    userPrompt,
    timeoutMs,
  });

  core.debug(`[${label}] SYSTEM PROMPT (${systemPrompt.length} chars):\n${systemPrompt}`);
  core.debug(`[${label}] USER PROMPT (${userPrompt.length} chars):\n${userPrompt}`);

  const attemptParse = (raw: string, attempt: 'first' | 'retry'): T | null => {
    try {
      const value = parse(raw);
      core.debug(`[${label}] RAW RESPONSE (${attempt}):\n${raw}`);
      return value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.debug(`[${label}] Parse failed (${attempt}): ${msg}`);
      core.debug(`[${label}] RAW RESPONSE (unparseable, ${attempt}):\n${raw}`);
      return null;
    }
  };

  const first = attemptParse(response.review, 'first');
  if (first !== null) {
    return {
      ok: true,
      value: first,
      tokensUsed: response.tokensUsed,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  }

  core.warning(`[${label}] Failed to parse output on first attempt — retrying once...`);

  const retry = await provider.review({
    systemPrompt,
    systemPromptBlocks,
    userPrompt,
    timeoutMs,
  });
  const second = attemptParse(retry.review, 'retry');
  if (second !== null) {
    return {
      ok: true,
      value: second,
      tokensUsed: response.tokensUsed + retry.tokensUsed,
      inputTokens: response.inputTokens + retry.inputTokens,
      outputTokens: response.outputTokens + retry.outputTokens,
    };
  }

  const reason = 'Output unparseable after retry';
  core.warning(`[${label}] ${reason} — will use degraded fallback`);
  return {
    ok: false,
    reason,
    tokensUsed: response.tokensUsed + retry.tokensUsed,
    inputTokens: response.inputTokens + retry.inputTokens,
    outputTokens: response.outputTokens + retry.outputTokens,
  };
}

export async function runJudge(
  provider: AIProvider,
  specialistResults: SpecialistResult[],
  config: ReviewConfig,
): Promise<JudgeResult> {
  const allFindings = collectSpecialistFindings(specialistResults);

  core.info(`[judge/dedup] Deduplicating ${allFindings.length} raw finding(s)...`);

  if (judgeCanSkipLLM(allFindings)) {
    core.info(
      `[judge/dedup] Skipping LLM dedup — ${allFindings.length} finding(s) with no ` +
      `same-file overlap to merge (mechanical dedup only)`,
    );
    return {
      structured: buildJudgeReviewFromDedup(mechanicalDedup(allFindings)),
      tokens: { input: 0, output: 0 },
      apiCalls: 0,
    };
  }

  const dedupOutcome = await callWithParseRetry(
    'judge/dedup',
    provider,
    buildJudgeDedupSystemPrompt(config),
    buildJudgeDedupUserPrompt(allFindings),
    TIMEOUT_MS,
    parseDedupedFindings,
  );

  const inputTokens = dedupOutcome.inputTokens;
  const outputTokens = dedupOutcome.outputTokens;
  let structured: StructuredReview;

  if (!dedupOutcome.ok) {
    core.warning(
      `[judge/dedup] Parse failure — publishing unverified specialist findings (${dedupOutcome.reason})`,
    );
    structured = buildUnverifiedFallback(allFindings, dedupOutcome.reason);
  } else {
    const dedupFindings = dedupOutcome.value;
    core.info(
      `[judge/dedup] ${dedupFindings.length} finding(s) after dedup (${dedupOutcome.tokensUsed} tokens)`,
    );
    structured = buildJudgeReviewFromDedup(dedupFindings);
    core.info(
      `[judge/dedup] Final output: ${structured.findings.length} finding(s) (${inputTokens + outputTokens} total judge tokens)`,
    );
  }

  return {
    structured,
    tokens: { input: inputTokens, output: outputTokens },
    apiCalls: 1,
  };
}
