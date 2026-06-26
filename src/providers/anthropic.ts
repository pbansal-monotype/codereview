import Anthropic from '@anthropic-ai/sdk';
import { parseStructuredReview } from '../output/findings';
import { withRetry } from '../retry';
import { AIProvider, ReviewRequest, ReviewResponse, SystemPromptBlock } from './types';

type AnthropicSystemBlock = Anthropic.TextBlockParam & {
  cache_control?: { type: 'ephemeral' };
};

function buildSystemBlocks(request: ReviewRequest): AnthropicSystemBlock[] | string {
  if (request.systemPromptBlocks && request.systemPromptBlocks.length > 0) {
    return request.systemPromptBlocks.map((block: SystemPromptBlock) => {
      const entry: AnthropicSystemBlock = { type: 'text', text: block.text };
      if (block.ephemeralCache) {
        entry.cache_control = { type: 'ephemeral' };
      }
      return entry;
    });
  }
  return request.systemPrompt;
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const system = buildSystemBlocks(request);

    const response = await withRetry(
      () =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          temperature: 0,
          // The Anthropic SDK accepts either a string or an array of content blocks for `system`.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          system: system as any,
          messages: [{ role: 'user', content: request.userPrompt }],
        }),
      { timeoutMs: request.timeoutMs },
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

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    return {
      review: text,
      structured,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  }
}
