import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, formatApiCallCount } from '../cost';

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

describe('formatApiCallCount', () => {
  it('reports fixed count when no tool hops', () => {
    const summary = formatApiCallCount([
      { categoryId: 'security', apiCalls: 1 },
      { categoryId: 'code', apiCalls: 1 },
    ]);
    assert.ok(summary.includes('3'));
    assert.ok(summary.includes('2 specialist'));
  });

  it('reports per-specialist breakdown when tool loops add calls', () => {
    const summary = formatApiCallCount([
      { categoryId: 'security', apiCalls: 4 },
      { categoryId: 'code', apiCalls: 1 },
    ]);
    assert.ok(summary.includes('security=4'));
    assert.ok(summary.includes('6'));
  });
});
