export interface CategoryGuidelines {
    enabled: boolean;
    guidelines: string;
}
export interface ReviewConfig {
    provider: 'anthropic' | 'openai';
    apiKey: string;
    model: string;
    githubToken: string;
    categories: {
        security: CategoryGuidelines;
        tests: CategoryGuidelines;
        performance: CategoryGuidelines;
        cost: CategoryGuidelines;
        custom: CategoryGuidelines;
    };
    customPrompt: string;
    extraInstructions: string;
    maxDiffSize: number;
    postReviewComment: boolean;
    postInlineComments: boolean;
    failOnCritical: boolean;
    ignorePatterns: string[];
    redactSecrets: boolean;
    timeoutMs: number;
    includeFileContents: boolean;
    contextFiles: string[];
    maxFileSize: number;
}
export declare function getSpecialistJsonInstruction(): string;
export declare function getJudgeJsonInstruction(): string;
export declare function loadConfig(): ReviewConfig;
/**
 * Safe cross-model default for maximum combined prompt size (chars).
 * ~300K chars ≈ ~75K tokens, well within both Claude (200K) and GPT-4o (128K) limits.
 */
export declare const MAX_PROMPT_CHARS = 300000;
