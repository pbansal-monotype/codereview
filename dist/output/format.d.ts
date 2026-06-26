import { ReviewConfig } from '../config';
import { StructuredReview } from './findings';
import { PullRequestData } from '../github';
import { SpecialistResult, TokenUsage } from '../agents/types';
import { ReviewDebugStats } from './debug';
interface FormatOptions {
    structured?: StructuredReview;
    pr: PullRequestData;
    config: ReviewConfig;
    categories: string[];
    totalTokens: TokenUsage;
    apiCalls: number;
    specialistResults: SpecialistResult[];
    debug?: ReviewDebugStats;
}
export declare function formatReviewMarkdown(opts: FormatOptions): string;
export {};
//# sourceMappingURL=format.d.ts.map