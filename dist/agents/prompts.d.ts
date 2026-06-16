import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
interface FileSectionOptions {
    /** When true, test files are sorted first instead of last (use for the tests specialist). */
    prioritizeTests?: boolean;
}
export declare function buildFileContentsSection(pr: PullRequestData, budget: number, options?: FileSectionOptions): string;
/**
 * Builds the shared context — PR metadata, full file contents, and the diff.
 * The diff is always included regardless of budget. File contents are dropped
 * gracefully when the budget runs out (with a logged warning).
 *
 * @param prioritizeTests  When true, test files appear first in the file
 *   contents section (used for the tests specialist).
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
export {};
//# sourceMappingURL=prompts.d.ts.map