import OpenAI from 'openai';
import { parseStructuredReview } from '../findings';
import { withRetry } from '../retry';
import { AIProvider, ReviewRequest, ReviewResponse } from './types';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
    );

    const text = response.choices[0]?.message?.content ?? '';
    const tokensUsed =
      (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

    let structured;
    try {
      structured = parseStructuredReview(text);
    } catch {
      // Fallback to raw text
    }

    return { review: text, structured, tokensUsed };
  }
}
