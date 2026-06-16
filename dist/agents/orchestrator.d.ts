import { ReviewConfig } from '../config';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { ReviewResult } from './types';
export declare function runReview(provider: AIProvider, config: ReviewConfig, pr: PullRequestData): Promise<ReviewResult>;
//# sourceMappingURL=orchestrator.d.ts.map