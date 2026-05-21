import { AIProvider, ReviewRequest, ReviewResponse } from './types';
export declare class OpenAIProvider implements AIProvider {
    private client;
    private model;
    constructor(apiKey: string, model: string);
    review(request: ReviewRequest): Promise<ReviewResponse>;
}
//# sourceMappingURL=openai.d.ts.map