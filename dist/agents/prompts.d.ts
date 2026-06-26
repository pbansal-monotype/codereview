import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
import { Finding } from '../findings';
import { ToolCache } from '../context/tools';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
/**
 * Builds the shared context — PR metadata, then the risk-scored file sections
 * (each containing the diff hunk and, for high-risk files, the full file content).
 */
export declare function buildSharedContext(pr: PullRequestData, config: ReviewConfig, toolCache?: ToolCache): string;
export declare function buildSpecialistSystemPrompt(categoryId: string, guidelines: string, config: ReviewConfig): string;
/** Appends the specialist review instruction to the shared context. */
export declare function buildSpecialistUserPrompt(sharedContext: string): string;
export declare function buildJudgeDedupSystemPrompt(config: ReviewConfig): string;
export declare function buildJudgeDedupUserPrompt(allFindings: Finding[]): string;
/** Collect all findings from specialist results, attaching category from each agent. */
export declare function collectSpecialistFindings(specialistResults: SpecialistResult[]): Finding[];
//# sourceMappingURL=prompts.d.ts.map