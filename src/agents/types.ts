import { Finding, StructuredReview } from '../output/findings';
import type { FindingSuppression } from '../state/suppression';

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
  /** Actual LLM API calls made by this specialist (includes tool-loop hops and subagents). */
  apiCalls: number;
}

export interface ReviewRunOptions {
  /** Include detailed context ranking, tool calls, and pipeline stats in review output. */
  debug?: boolean;
  /** Dismissed fingerprints and prior findings — suppresses repeat reports. */
  suppression?: FindingSuppression;
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
