import { ReviewConfig } from '../config';
import { StructuredReview } from '../findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult, TokenUsage } from './types';
interface JudgeResult {
    structured: StructuredReview;
    tokens: TokenUsage;
}
export declare function runJudge(provider: AIProvider, specialistResults: SpecialistResult[], pr: PullRequestData, config: ReviewConfig, _sharedContext: string, _enabledCategories: string[]): Promise<JudgeResult>;
export {};
//# sourceMappingURL=judge.d.ts.map