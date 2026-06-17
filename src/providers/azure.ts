import { AzureOpenAI } from 'openai';
import { parseStructuredReview } from '../findings';
import { withRetry } from '../retry';
import { AIProvider, ReviewRequest, ReviewResponse } from './types';

const DEFAULT_API_VERSION = '2024-12-01-preview';

/**
 * Accepts either:
 *   - A full Azure deployment URL:
 *       https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>/chat/completions?api-version=...
 *   - A bare resource endpoint:
 *       https://<resource>.cognitiveservices.azure.com
 *
 * Returns { endpoint, apiVersion } where endpoint is always the bare resource URL.
 */
export function parseAzureEndpoint(raw: string): { endpoint: string; apiVersion: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid azure_endpoint URL: "${raw}"`);
  }

  const apiVersion = url.searchParams.get('api-version') ?? DEFAULT_API_VERSION;
  // Strip everything after the origin (path, query, fragment) to get the bare endpoint.
  const endpoint = url.origin;

  return { endpoint, apiVersion };
}

export class AzureProvider implements AIProvider {
  private client: AzureOpenAI;
  private deployment: string;

  /**
   * @param apiKey       Value of AZURE_API_KEY
   * @param endpointUrl  Full deployment URL or bare resource endpoint
   * @param deployment   Azure deployment name (the "model" identifier in Azure OpenAI)
   */
  constructor(apiKey: string, endpointUrl: string, deployment: string) {
    const { endpoint, apiVersion } = parseAzureEndpoint(endpointUrl);
    this.client = new AzureOpenAI({ apiKey, endpoint, apiVersion });
    this.deployment = deployment;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.deployment,
          max_tokens: 8192,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
      { timeoutMs: request.timeoutMs },
    );

    const text = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    let structured;
    try {
      structured = parseStructuredReview(text);
    } catch {
      // Fallback to raw text
    }

    return {
      review: text,
      structured,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  }
}
