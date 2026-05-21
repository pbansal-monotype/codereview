import { AIProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';

export type { AIProvider, ReviewRequest, ReviewResponse } from './types';

export function createProvider(
  provider: 'anthropic' | 'openai',
  apiKey: string,
  model: string,
): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, model);
    case 'openai':
      return new OpenAIProvider(apiKey, model);
    default:
      throw new Error(`Unsupported provider: ${provider}. Use "anthropic" or "openai".`);
  }
}
