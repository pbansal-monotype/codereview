import type { ReviewConfig } from '../config';
import { type StructuredReview } from '../output/findings';
import type { PullRequestData } from '../github';
import type { SpecialistResult } from '../agents/types';
import type { FindingRecord, RunRecord } from './types';
export interface BuildRecordInput {
    repo: string;
    pr: PullRequestData;
    config: ReviewConfig;
    structured?: StructuredReview;
    categories: string[];
    inputTokens: number;
    outputTokens: number;
    apiCalls: number;
    durationMs: number;
    /** True when the run replayed stored findings for an already-reviewed SHA. */
    cached: boolean;
    specialistResults?: SpecialistResult[];
    /** Actions run metadata; absent outside a workflow (e.g. the local CLI). */
    githubContext?: {
        runId?: string;
        runAttempt?: string;
        actor?: string;
        workflow?: string;
    };
}
export declare function buildRunRecord(input: BuildRecordInput): {
    run: RunRecord;
    findings: FindingRecord[];
};
/** Rebuild a StructuredReview from history rows so a same-SHA replay needs no LLM. */
export declare function structuredFromHistoryFindings(rows: FindingRecord[]): StructuredReview;
//# sourceMappingURL=record.d.ts.map