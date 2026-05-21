import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, countRedactions } from '../redact';

describe('redactSecrets', () => {
  it('redacts AWS access keys', () => {
    const input = 'const key = "AKIAIOSFODNN7EXAMPLE";';
    const out = redactSecrets(input);
    assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('redacts GitHub tokens', () => {
    const input = 'token = ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const out = redactSecrets(input);
    assert.ok(!out.includes('ghp_'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('redacts api_key assignments', () => {
    const input = 'api_key = "super-secret-value-12345"';
    const out = redactSecrets(input);
    assert.ok(!out.includes('super-secret-value'));
  });

  it('counts redactions', () => {
    const before =
      'a=AKIAIOSFODNN7EXAMPLE b=AKIA0000000000000001';
    const after = redactSecrets(before);
    assert.equal(countRedactions(before, after), 2);
  });
});
