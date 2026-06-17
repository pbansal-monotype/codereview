/**
 * Approximate cost estimation for AI provider calls.
 * Prices in USD per million tokens — updated periodically, not guaranteed exact.
 */

interface TokenRate {
  input: number;
  output: number;
}

const RATES: Array<{ pattern: string; rate: TokenRate }> = [
  // Anthropic
  { pattern: 'claude-sonnet-4', rate: { input: 3, output: 15 } },
  { pattern: 'claude-3-5-sonnet', rate: { input: 3, output: 15 } },
  { pattern: 'claude-3-5-haiku', rate: { input: 0.8, output: 4 } },
  { pattern: 'claude-3-haiku', rate: { input: 0.25, output: 1.25 } },
  { pattern: 'claude-3-opus', rate: { input: 15, output: 75 } },
  // OpenAI
  { pattern: 'gpt-4o-mini', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-4o', rate: { input: 2.5, output: 10 } },
  { pattern: 'gpt-4-turbo', rate: { input: 10, output: 30 } },
  { pattern: 'gpt-4', rate: { input: 30, output: 60 } },
  { pattern: 'o1-mini', rate: { input: 3, output: 12 } },
  { pattern: 'o1', rate: { input: 15, output: 60 } },
  // Azure
  { pattern: 'gpt-5.4-nano', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-5.4', rate: { input: 2.5, output: 10 } },
  { pattern: 'gpt-5.4-mini', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-5.4-small', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-5.4-medium', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-5.4-large', rate: { input: 0.15, output: 0.6 } },
  { pattern: 'gpt-5.4-xlarge', rate: { input: 0.15, output: 0.6 } },
];

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string | null {
  const match = RATES.find((r) => model.includes(r.pattern));
  if (!match) return null;

  const cost =
    (inputTokens * match.rate.input + outputTokens * match.rate.output) / 1_000_000;

  if (cost < 0.001) return '<$0.001';
  return `~$${cost.toFixed(3)}`;
}
