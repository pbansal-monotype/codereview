import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
import { Finding } from '../findings';
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
export declare function buildJudgeDedupSystemPrompt(config: ReviewConfig): string;
export declare function buildJudgeDedupUserPrompt(allFindings: Finding[]): string;
export declare function buildJudgeRewriteSystemPrompt(config: ReviewConfig): string;
export declare function buildJudgeRewriteUserPrompt(dedupedFindings: Finding[], pr: PullRequestData): string;
/** Collect all findings from specialist results, attaching category from each agent. */
export declare function collectSpecialistFindings(specialistResults: SpecialistResult[]): Finding[];
/** @deprecated Use buildJudgeDedupSystemPrompt / buildJudgeRewriteSystemPrompt */
export declare function buildJudgeSystemPrompt(config: ReviewConfig, _enabledCategories: string[]): string;
/** @deprecated Use buildJudgeDedupUserPrompt / buildJudgeRewriteUserPrompt */
export declare function buildJudgeUserPrompt(specialistResults: SpecialistResult[], pr: PullRequestData, _sharedContext: string): string;
//# sourceMappingURL=prompts.d.ts.map