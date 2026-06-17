import * as core from '@actions/core';
import { CategoryGuidelines, ReviewConfig } from '../config';
import { Finding, parseSpecialistFindings } from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
import {
  CATEGORY_LABELS,
  buildSpecialistSystemPrompt,
  buildSpecialistUserPrompt,
} from './prompts';

export async function runSpecialistAgent(
  provider: AIProvider,
  categoryId: string,
  guidelines: CategoryGuidelines,
  pr: PullRequestData,
  config: ReviewConfig,
  sharedContext: string,
): Promise<SpecialistResult> {
  const label = CATEGORY_LABELS[categoryId] || categoryId;

  try {
    core.info(`[${categoryId}] Specialist starting...`);

    const systemPrompt = buildSpecialistSystemPrompt(
      categoryId,
      guidelines.guidelines,
      config,
    );
    const userPrompt = buildSpecialistUserPrompt(sharedContext);

    core.debug(`[${categoryId}] SYSTEM PROMPT (${systemPrompt.length} chars):\n${systemPrompt}`);
    core.debug(`[${categoryId}] USER PROMPT (${userPrompt.length} chars):\n${userPrompt}`);

    const response = await provider.review({
      systemPrompt,
      userPrompt,
      timeoutMs: config.timeoutMs,
    });

    let findings: Finding[];
    try {
      findings = parseSpecialistFindings(response.review, categoryId);
    } catch {
      core.warning(`[${categoryId}] Failed to parse specialist output as JSON`);
      core.debug(`[${categoryId}] RAW RESPONSE:\n${response.review}`);
      findings = [];
    }

    core.debug(`[${categoryId}] RAW RESPONSE (${response.review.length} chars):\n${response.review}`);

    core.info(
      `[${categoryId}] ${label} found ${findings.length} issue(s) (${response.tokensUsed} tokens)`,
    );

    return {
      categoryId,
      findings,
      tokens: { input: response.inputTokens, output: response.outputTokens },
      failed: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`[${categoryId}] ${label} specialist failed: ${message}`);
    return {
      categoryId,
      findings: [],
      tokens: { input: 0, output: 0 },
      failed: true,
      error: message,
    };
  }
}
