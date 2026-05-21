import { AIProvider, ReviewRequest, ReviewResponse } from './types';
export declare class AnthropicProvider implements AIProvider {
    private client;
    private model;
    constructor(apiKey: string, model: string);
    review(request: ReviewRequest): Promise<ReviewResponse>;
}
//# sourceMappingURL=anthropic.d.ts.map