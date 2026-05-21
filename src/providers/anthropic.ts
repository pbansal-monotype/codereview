import Anthropic from '@anthropic-ai/sdk';
import { parseStructuredReview } from '../findings';
import { withRetry } from '../retry';
import { AIProvider, ReviewRequest, ReviewResponse } from './types';

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const response = await withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    let structured;
    try {
      structured = parseStructuredReview(text);
    } catch {
      // Fallback: unstructured text still shown in PR comment
    }

    return {
      review: text,
      structured,
      tokensUsed:
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    };
  }
}
