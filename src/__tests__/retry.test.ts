import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../retry';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it('retries on retryable error and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error('429 rate limit');
        return Promise.resolve('ok');
      },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 0 },
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('throws immediately on non-retryable error', async () => {
    await assert.rejects(
      () =>
        withRetry(() => Promise.reject(new Error('invalid api key')), {
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 50,
          timeoutMs: 0,
        }),
      { message: 'invalid api key' },
    );
  });

  it('throws after max attempts exhausted', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            attempts++;
            return Promise.reject(new Error('503 service unavailable'));
          },
          { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 0 },
        ),
      { message: '503 service unavailable' },
    );
    assert.equal(attempts, 2);
  });

  it('times out long-running requests', async () => {
    await assert.rejects(
      () =>
        withRetry(
          () =>
            new Promise((resolve) => {
              const t = setTimeout(resolve, 5000);
              if (typeof t === 'object' && 'unref' in t) t.unref();
            }),
          { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 50 },
        ),
      /timed out/,
    );
  });
});
