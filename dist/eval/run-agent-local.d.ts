/**
 * run-agent-local.ts
 *
 * Run guideline specialists or the judge agent locally against a diff file.
 * Accepts raw unified diffs or GitHub Actions debug logs (e.g. Debug/securitylogs.txt).
 *
 * Usage:
 *   npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent security
 *   npx ts-node src/eval/run-agent-local.ts --agent judge --findings Debug/judge.txt
 *   npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent judge --findings specialists.json
 *
 * Options:
 *   --agent <id>        security | tests | performance | code | judge | all  (default: security)
 *   --metadata <file>   JSON with PR title/body/author/branches and optional fileContents
 *   --files-dir <dir>   Directory tree whose paths mirror repo files (loads full file context)
 *   --findings <file>   Specialist JSON or GitHub Actions judge debug log
 *   --output <file>     Write JSON result to file instead of stdout
 *   --provider <name>   anthropic | openai | azure  (default: azure)
 *   --model <name>      Override default model for the provider
 *   --verbose           Print raw LLM responses to stderr
 *
 * Findings file format (for --agent judge):
 *   {
 *     "enabledCategories": ["security", "code"],
 *     "specialistResults": [
 *       {
 *         "categoryId": "security",
 *         "findings": [{ "category": "security", "severity": "critical", ... }],
 *         "tokens": { "input": 0, "output": 0 },
 *         "failed": false
 *       }
 *     ]
 *   }
 */
import type { SpecialistResult } from '../agents/types';
import type { FileContent } from '../github';
interface LocalMetadata {
    number?: number;
    title?: string;
    body?: string;
    author?: string;
    headBranch?: string;
    baseBranch?: string;
    customPrompt?: string;
    fileContents?: FileContent[];
}
interface NormalizedDiffInput {
    diff: string;
    metadata: LocalMetadata;
}
interface FindingsInput {
    enabledCategories?: string[];
    specialistResults: SpecialistResult[];
}
/**
 * Normalize diff input from:
 * - raw unified git diffs
 * - GitHub Actions debug logs (`2026-06-17T07:18:04.0467177Z ##[debug]…`)
 * - per-file `<diff path="…">…</diff>` blocks
 * - legacy `<diff>…</diff>` blocks with optional ```diff fences
 */
export declare function normalizeDiffInput(raw: string): NormalizedDiffInput;
/** Parse specialist findings from a judge user-prompt debug log. */
export declare function parseJudgeDebugLog(raw: string): FindingsInput;
export {};
//# sourceMappingURL=run-agent-local.d.ts.map