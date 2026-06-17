import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
/**
 * Builds the shared context — PR metadata, then the risk-scored file sections
 * (each containing the diff hunk and, for high-risk files, the full file content).
 *
 * @param prioritizeTests  When true (tests specialist), test-file scores are boosted
 *   so they receive high-priority treatment. When false (all other specialists),
 *   test files fall below the medium-risk threshold and are skipped entirely.
 */
export declare function buildSharedContext(pr: PullRequestData, config: ReviewConfig, prioritizeTests?: boolean): string;
export declare function buildSpecialistSystemPrompt(categoryId: string, guidelines: string, config: ReviewConfig): string;
/** Appends the specialist review instruction to the shared context. */
export declare function buildSpecialistUserPrompt(sharedContext: string): string;
export declare function buildJudgeSystemPrompt(config: ReviewConfig, enabledCategories: string[]): string;
/**
 * Builds the judge's prompt.
 * Receives the pre-built sharedContext (diff + full file contents) so the
 * judge can verify every finding against real code — not just the diff.
 * The judge receives the same context budget as the specialists (no truncation).
 */
export declare function buildJudgeUserPrompt(specialistResults: SpecialistResult[], pr: PullRequestData, sharedContext: string): string;
//# sourceMappingURL=prompts.d.ts.map