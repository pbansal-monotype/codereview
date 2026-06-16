import { Finding, StructuredReview } from '../findings';

export interface TokenUsage {
  input: number;
  output: number;
}

export interface SpecialistResult {
  categoryId: string;
  findings: Finding[];
  tokens: TokenUsage;
  failed: boolean;
  error?: string;
}

export interface ReviewResult {
  markdown: string;
  hasCritical: boolean;
  categories: string[];
  structured?: StructuredReview;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}
