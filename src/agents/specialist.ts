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
): Promise<SpecialistResult> {
  const label = CATEGORY_LABELS[categoryId] || categoryId;

  try {
    core.info(`[${categoryId}] Specialist starting...`);

    const systemPrompt = buildSpecialistSystemPrompt(
      categoryId,
      guidelines.guidelines,
      config,
    );
    const userPrompt = buildSpecialistUserPrompt(pr, config);

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
      findings = [];
    }

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
