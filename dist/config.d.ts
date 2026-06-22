import type { StoreType } from './state';
export interface CategoryGuidelines {
    enabled: boolean;
    guidelines: string;
}
export interface ReviewConfig {
    provider: 'anthropic' | 'openai' | 'azure';
    apiKey: string;
    model: string;
    /** Required when provider is "azure". Bare resource endpoint or full deployment URL. */
    azureEndpoint: string;
    githubToken: string;
    categories: {
        security: CategoryGuidelines;
        tests: CategoryGuidelines;
        performance: CategoryGuidelines;
        code: CategoryGuidelines;
        custom: CategoryGuidelines;
    };
    repoContext: string;
    reviewPolicy: string;
    ignorePatterns: string[];
    stateStore: StoreType;
    stateGistId: string;
    incrementalReview: boolean;
}
/** Token budget helpers — rough estimate: 1 token ≈ 4 characters of English/code text. */
export declare function charsToTokens(chars: number): number;
export declare function tokensToChars(tokens: number): number;
/**
 * Maximum tokens to include in any single prompt (shared context).
 * Specialists and judge both operate within this ceiling.
 * 75 000 tokens ≈ 300 000 chars, matching model context windows for claude-sonnet-4.
 */
export declare const MAX_PROMPT_TOKENS = 75000;
/** Timeout per LLM API call in milliseconds. */
export declare const TIMEOUT_MS = 120000;
/** Maximum characters per file when including file contents. */
export declare const MAX_FILE_SIZE = 10000;
/** Shared severity scale — identical wording used in both specialist and judge prompts. */
export declare const SEVERITY_RUBRIC = "Severity scale (identical for all agents):\n- \"critical\": would you page the on-call engineer at 3 am? Data loss, auth bypass, crash, secret exposure.\n- \"warning\": real bug but not urgent \u2014 will cause problems but not tonight.\n- \"suggestion\": concrete improvement with specific code; a reasonable engineer would skip it without regret.";
export declare function getSpecialistJsonInstruction(): string;
export declare function getJudgeDedupJsonInstruction(): string;
export declare function getJudgeRewriteJsonInstruction(): string;
/** @deprecated Use getJudgeRewriteJsonInstruction */
export declare function getJudgeJsonInstruction(): string;
export declare function loadConfig(): ReviewConfig;
/**
 * Back-compat alias — prefer MAX_PROMPT_TOKENS for new code.
 * Kept so callers that import MAX_PROMPT_CHARS still compile.
 */
export declare const MAX_PROMPT_CHARS: number;
