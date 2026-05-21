import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../cost';

describe('estimateCost', () => {
  it('estimates Claude Sonnet cost', () => {
    const cost = estimateCost('claude-sonnet-4-20250514', 10000, 2000);
    assert.ok(cost);
    assert.ok(cost.startsWith('~$') || cost.startsWith('<$'));
  });

  it('estimates GPT-4o cost', () => {
    const cost = estimateCost('gpt-4o', 10000, 2000);
    assert.ok(cost);
  });

  it('returns null for unknown model', () => {
    const cost = estimateCost('unknown-model-xyz', 10000, 2000);
    assert.equal(cost, null);
  });

  it('handles very small costs', () => {
    const cost = estimateCost('gpt-4o-mini', 100, 50);
    assert.ok(cost);
    assert.ok(cost.includes('<$0.001') || cost.includes('~$'));
  });
});
