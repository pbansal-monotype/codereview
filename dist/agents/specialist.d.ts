import { CategoryGuidelines, ReviewConfig } from '../config';
import { AIProvider } from '../providers';
import { PullRequestData } from '../github';
import { SpecialistResult } from './types';
import { ToolContext } from '../context/on-demand/tools';
import type { ToolLoopDebugRecorder } from '../output/debug';
import type { FindingSuppression } from '../state/suppression';
export declare function runSpecialistAgent(provider: AIProvider, categoryId: string, guidelines: CategoryGuidelines, pr: PullRequestData, config: ReviewConfig, sharedContext: string, toolCtx: ToolContext, debugRecorder?: ToolLoopDebugRecorder, suppression?: FindingSuppression): Promise<SpecialistResult>;
/** Build a per-PR tool context from fetched file contents (shared across specialists). */
export declare function buildToolContext(pr: PullRequestData, config: ReviewConfig): ToolContext;
//# sourceMappingURL=specialist.d.ts.map