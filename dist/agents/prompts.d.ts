import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
export declare function buildFileContentsSection(pr: PullRequestData, budget: number): string;
/**
 * Builds the shared context once — PR metadata, full file contents, and the diff.
 * Passed to every specialist and to the Judge, so the expensive file-content
 * assembly runs exactly once per review.
 */
export declare function buildSharedContext(pr: PullRequestData, config: ReviewConfig): string;
export declare function buildSpecialistSystemPrompt(categoryId: string, guidelines: string, config: ReviewConfig): string;
/** Appends the specialist review instruction to the shared context. */
export declare function buildSpecialistUserPrompt(sharedContext: string): string;
export declare function buildJudgeSystemPrompt(config: ReviewConfig): string;
/**
 * Builds the judge's prompt.
 * Receives the pre-built sharedContext (diff + full file contents) so the
 * judge can verify every finding against real code — not just the diff.
 */
export declare function buildJudgeUserPrompt(specialistResults: SpecialistResult[], pr: PullRequestData, sharedContext: string): string;
//# sourceMappingURL=prompts.d.ts.map