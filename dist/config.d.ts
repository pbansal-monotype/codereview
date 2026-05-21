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
}
export declare function loadConfig(): ReviewConfig;
export declare function getJsonOutputInstruction(): string;
