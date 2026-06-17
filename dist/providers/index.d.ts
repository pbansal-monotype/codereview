import { AIProvider } from './types';
export type { AIProvider, ReviewRequest, ReviewResponse } from './types';
export declare function createProvider(provider: 'anthropic' | 'openai' | 'azure', apiKey: string, model: string, azureEndpoint?: string): AIProvider;
//# sourceMappingURL=index.d.ts.map