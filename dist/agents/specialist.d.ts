import { CategoryGuidelines, ReviewConfig } from '../config';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
export declare function runSpecialistAgent(provider: AIProvider, categoryId: string, guidelines: CategoryGuidelines, pr: PullRequestData, config: ReviewConfig, sharedContext: string): Promise<SpecialistResult>;
//# sourceMappingURL=specialist.d.ts.map