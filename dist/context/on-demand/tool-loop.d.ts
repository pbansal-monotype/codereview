import { AIProvider } from '../../providers';
import { Finding } from '../../output/findings';
import { ToolContext } from './tools';
import { TokenUsage } from '../../agents/types';
import type { ToolLoopDebugRecorder } from '../../output/debug';
export declare function specialistUsesToolLoop(categoryId: string): boolean;
export interface ToolLoopResult {
    findings: Finding[];
    tokens: TokenUsage;
    apiCalls: number;
}
export declare function runSpecialistToolLoop(provider: AIProvider, categoryId: string, systemPrompt: string, userPrompt: string, toolCtx: ToolContext, timeoutMs: number, debugRecorder?: ToolLoopDebugRecorder): Promise<ToolLoopResult>;
//# sourceMappingURL=tool-loop.d.ts.map