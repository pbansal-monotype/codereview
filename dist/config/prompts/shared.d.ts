import { ReviewConfig } from '../app';
import { PullRequestData } from '../../github';
import type { ReviewContext } from '../../context/diff';
import { ToolCache } from '../../context/on-demand/tools';
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function buildPrMetadata(pr: PullRequestData, config: ReviewConfig): string;
/**
 * Builds the shared context — PR metadata, then the risk-scored file sections
 * (each containing the diff hunk and, for high-risk files, the full file content).
 */
export declare function buildSharedContext(pr: PullRequestData, config: ReviewConfig, toolCache?: ToolCache, collectRanking?: boolean): string;
export interface SharedContextResult {
    prompt: string;
    reviewContext: ReviewContext;
}
export declare function buildSharedContextResult(pr: PullRequestData, config: ReviewConfig, toolCache?: ToolCache, collectRanking?: boolean): SharedContextResult;
//# sourceMappingURL=shared.d.ts.map