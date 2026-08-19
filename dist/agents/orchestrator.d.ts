import { ReviewConfig } from '../config';
import { Finding, StructuredReview } from '../output/findings';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { ReviewResult, ReviewRunOptions } from './types';
export declare function filterFindingsToDiff(structured: StructuredReview, diff: string): {
    structured: StructuredReview;
    dropped: Finding[];
};
export declare function runReview(provider: AIProvider, config: ReviewConfig, pr: PullRequestData, options?: ReviewRunOptions): Promise<ReviewResult>;
//# sourceMappingURL=orchestrator.d.ts.map