import { ReviewConfig } from '../config';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
export declare function buildFileContentsSection(pr: PullRequestData, budget: number): string;
export declare function buildSpecialistSystemPrompt(categoryId: string, guidelines: string, config: ReviewConfig): string;
export declare function buildSpecialistUserPrompt(pr: PullRequestData, config: ReviewConfig): string;
export declare function buildJudgeSystemPrompt(config: ReviewConfig): string;
export declare function buildJudgeUserPrompt(specialistResults: SpecialistResult[], pr: PullRequestData): string;
//# sourceMappingURL=prompts.d.ts.map