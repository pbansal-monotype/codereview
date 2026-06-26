import * as core from '@actions/core';
import { CategoryGuidelines, ReviewConfig, TIMEOUT_MS } from '../config';
import { Finding, parseSpecialistFindings } from '../output/findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
import {
  CATEGORY_LABELS,
  buildSpecialistSystemPrompt,
  buildSpecialistUserPrompt,
} from '../config/prompts';
import { ToolContext, createToolContext } from '../context/on-demand/tools';
import { runSpecialistToolLoop, specialistUsesToolLoop } from '../context/on-demand/tool-loop';
import type { ToolLoopDebugRecorder } from '../output/debug';

export async function runSpecialistAgent(
  provider: AIProvider,
  categoryId: string,
  guidelines: CategoryGuidelines,
  pr: PullRequestData,
  config: ReviewConfig,
  sharedContext: string,
  toolCtx: ToolContext,
  debugRecorder?: ToolLoopDebugRecorder,
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

    if (specialistUsesToolLoop(categoryId)) {
      const loopResult = await runSpecialistToolLoop(
        provider,
        categoryId,
        systemPrompt,
        userPrompt,
        toolCtx,
        TIMEOUT_MS,
        debugRecorder,
      );

      core.info(
        `[${categoryId}] ${label} found ${loopResult.findings.length} issue(s) ` +
        `(${loopResult.tokens.input + loopResult.tokens.output} tokens, ` +
        `${loopResult.apiCalls} API call(s))`,
      );

      return {
        categoryId,
        findings: loopResult.findings,
        tokens: loopResult.tokens,
        apiCalls: loopResult.apiCalls,
        failed: false,
      };
    }

    const response = await provider.review({
      systemPrompt,
      userPrompt,
      timeoutMs: TIMEOUT_MS,
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
      apiCalls: 1,
      failed: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`[${categoryId}] ${label} specialist failed: ${message}`);
    return {
      categoryId,
      findings: [],
      tokens: { input: 0, output: 0 },
      apiCalls: 0,
      failed: true,
      error: message,
    };
  }
}

/** Build a per-PR tool context from fetched file contents (shared across specialists). */
export function buildToolContext(pr: PullRequestData, config: ReviewConfig): ToolContext {
  const fileContentsMap: Record<string, string> = {};
  for (const f of pr.fileContents) {
    fileContentsMap[f.path] = f.content;
  }
  return createToolContext(fileContentsMap, config.ignorePatterns);
}
