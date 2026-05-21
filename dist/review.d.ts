import { ReviewConfig } from './config';
import { StructuredReview } from './findings';
import { AIProvider } from './providers';
import { PullRequestData } from './github';
export interface ReviewResult {
    markdown: string;
    hasCritical: boolean;
    categories: string[];
    structured?: StructuredReview;
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
}
export declare function runReview(provider: AIProvider, config: ReviewConfig, pr: PullRequestData): Promise<ReviewResult>;
