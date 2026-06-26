/**
 * Approximate cost estimation for AI provider calls.
 * Prices in USD per million tokens — updated periodically, not guaranteed exact.
 */
export declare function estimateCost(model: string, inputTokens: number, outputTokens: number): string | null;
/** Format API call count for review stats — reflects variable tool-loop usage. */
export declare function formatApiCallCount(specialistResults: Array<{
    categoryId: string;
    apiCalls: number;
}>, judgeCalls?: number): string;
