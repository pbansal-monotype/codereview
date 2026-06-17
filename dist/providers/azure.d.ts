import { AIProvider, ReviewRequest, ReviewResponse } from './types';
/**
 * Accepts either:
 *   - A full Azure deployment URL:
 *       https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>/chat/completions?api-version=...
 *   - A bare resource endpoint:
 *       https://<resource>.cognitiveservices.azure.com
 *
 * Returns { endpoint, apiVersion } where endpoint is always the bare resource URL.
 */
export declare function parseAzureEndpoint(raw: string): {
    endpoint: string;
    apiVersion: string;
};
export declare class AzureProvider implements AIProvider {
    private client;
    private deployment;
    /**
     * @param apiKey       Value of AZURE_API_KEY
     * @param endpointUrl  Full deployment URL or bare resource endpoint
     * @param deployment   Azure deployment name (the "model" identifier in Azure OpenAI)
     */
    constructor(apiKey: string, endpointUrl: string, deployment: string);
    review(request: ReviewRequest): Promise<ReviewResponse>;
}
//# sourceMappingURL=azure.d.ts.map