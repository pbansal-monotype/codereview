import { AIProvider } from '../providers';
import { Finding } from '../findings';
import { ToolContext } from '../context/tools';
import { TokenUsage } from './types';
export declare function specialistUsesToolLoop(categoryId: string): boolean;
export declare const TOOL_INSTRUCTIONS = "\n## On-demand context tools\n\nYou may request additional context before finalizing findings. Respond with JSON in ONE of these forms:\n\n**Request a tool** (up to 3 times):\n{\n  \"action\": \"tool\",\n  \"tool\": \"read_file\" | \"search_text\" | \"find_references\",\n  \"arguments\": { ... }\n}\n\nTool argument schemas:\n- read_file: { \"path\": \"src/foo.ts\" }\n- search_text: { \"path_pattern\"?: \"*.ts\", \"pattern\": \"regex or literal\" }\n- find_references: { \"symbol\": \"functionName\", \"file_path\": \"src/foo.ts\" }\n\n**Return final findings**:\n{\n  \"action\": \"done\",\n  \"findings\": [ ... same schema as specialist findings ... ]\n}\n\nUse tools when the shared context is insufficient \u2014 especially for signature/API changes.\nAfter tool results, either call another tool or return action \"done\".\n";
export interface ToolLoopResult {
    findings: Finding[];
    tokens: TokenUsage;
    apiCalls: number;
}
export declare function runSpecialistToolLoop(provider: AIProvider, categoryId: string, systemPrompt: string, userPrompt: string, toolCtx: ToolContext, timeoutMs: number): Promise<ToolLoopResult>;
//# sourceMappingURL=tool-loop.d.ts.map