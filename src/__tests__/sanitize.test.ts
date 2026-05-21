import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeErrorMessage } from '../sanitize';

describe('sanitizeErrorMessage', () => {
  it('redacts Anthropic API keys', () => {
    const msg = 'Authentication error: invalid key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const result = sanitizeErrorMessage(msg);
    assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz'));
    assert.ok(result.includes('sk-ant-***'));
  });

  it('redacts OpenAI API keys', () => {
    const msg = 'Error: invalid api key sk-proj-abcdefghijklmnopqrstuvwxyz1234';
    const result = sanitizeErrorMessage(msg);
    assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz'));
    assert.ok(result.includes('sk-proj-***'));
  });

  it('redacts GitHub tokens', () => {
    const msg = 'Bad credentials for ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeErrorMessage(msg);
    assert.ok(!result.includes('1234567890abcdef'));
    assert.ok(result.includes('gh*_***'));
  });

  it('preserves non-secret content', () => {
    const msg = 'Network error: connection refused on port 443';
    assert.equal(sanitizeErrorMessage(msg), msg);
  });

  it('redacts Bearer tokens', () => {
    const msg = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
    const result = sanitizeErrorMessage(msg);
    assert.ok(!result.includes('eyJhbGci'));
    assert.ok(result.includes('Bearer ***'));
  });
});
