import { AIProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { AzureProvider } from './azure';

export type { AIProvider, ReviewRequest, ReviewResponse } from './types';

export function createProvider(
  provider: 'anthropic' | 'openai' | 'azure',
  apiKey: string,
  model: string,
  azureEndpoint?: string,
): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, model);
    case 'openai':
      return new OpenAIProvider(apiKey, model);
    case 'azure': {
      if (!azureEndpoint) {
        throw new Error(
          'Azure provider requires an endpoint URL. Set the "azure_endpoint" input or the AZURE_ENDPOINT env var.',
        );
      }
      return new AzureProvider(apiKey, azureEndpoint, model);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}. Use "anthropic", "openai", or "azure".`);
  }
}
