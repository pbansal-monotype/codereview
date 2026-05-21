import { StructuredReview } from '../findings';

export interface ReviewRequest {
  systemPrompt: string;
  userPrompt: string;
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
