import { ReviewConfig } from '../config';
import { StructuredReview } from '../findings';
import { AIProvider } from '../providers';
import { SpecialistResult, TokenUsage } from './types';
interface JudgeResult {
    structured: StructuredReview;
    tokens: TokenUsage;
}
export declare function runJudge(provider: AIProvider, specialistResults: SpecialistResult[], config: ReviewConfig): Promise<JudgeResult>;
export {};
//# sourceMappingURL=judge.d.ts.map