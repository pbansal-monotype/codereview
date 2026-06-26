import { type ReferenceLocation, type ToolContext } from '../on-demand/tools';
import type { FileDiff } from './types';
export interface ScoredFile extends FileDiff {
    score: number;
    effectiveScore: number;
    callerRefs: ReferenceLocation[];
}
export declare function applyBlastRadiusScoring(scored: Array<FileDiff & {
    score: number;
}>, fileContents: Record<string, string>, toolCtx: ToolContext): ScoredFile[];
//# sourceMappingURL=blast-radius.d.ts.map