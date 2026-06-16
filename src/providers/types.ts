import { StructuredReview } from '../findings';

/** A single block in a structured system prompt. */
export interface SystemPromptBlock {
  text: string;
  /** When true, signals the provider to set a cache breakpoint after this block (Anthropic only). */
  ephemeralCache?: boolean;
}

export interface ReviewRequest {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  /**
   * Optional structured system-prompt blocks for providers that support
   * prompt caching (e.g. Anthropic). When set, supersedes `systemPrompt`.
   */
  systemPromptBlocks?: SystemPromptBlock[];
}

export interface ReviewResponse {
  review: string;
  structured?: StructuredReview;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AIProvider {
  review(request: ReviewRequest): Promise<ReviewResponse>;
}
