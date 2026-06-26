import { Finding } from './findings';
import { SpecialistResult } from '../agents/types';
import { FileRankingEntry, ReviewContextStats } from '../context/diff/types';
export interface ToolCallRecord {
    categoryId: string;
    hop: number;
    tool: string;
    arguments: Record<string, unknown>;
    resultSummary: string;
    callerVerdicts?: {
        file: string;
        line: number;
        breaks: string;
        why: string;
    }[];
}
export interface ReviewDebugStats {
    contextStats: ReviewContextStats;
    fileRanking: FileRankingEntry[];
    toolCalls: ToolCallRecord[];
    diffFilteredOut: Finding[];
    judgeUnverified: boolean;
    judgeRawFindings: number;
    judgeFinalFindings: number;
}
export declare class ToolLoopDebugRecorder {
    readonly calls: ToolCallRecord[];
    record(entry: ToolCallRecord): void;
}
export declare function formatDebugStatsMarkdown(stats: ReviewDebugStats, specialistResults: SpecialistResult[]): string;
//# sourceMappingURL=debug.d.ts.map