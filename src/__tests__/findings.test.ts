import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredReview,
  hasCriticalFindings,
  extractJson,
} from '../findings';

describe('parseStructuredReview', () => {
  it('parses valid JSON', () => {
    const raw = JSON.stringify({
      summary: 'Looks good',
      findings: [
        {
          category: 'security',
          severity: 'critical',
          file: 'src/auth.ts',
          line: 10,
          message: 'Hardcoded password',
        },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.summary, 'Looks good');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].severity, 'critical');
  });

  it('extracts JSON from markdown fences', () => {
    const raw = '```json\n{"summary":"ok","findings":[]}\n```';
    assert.equal(extractJson(raw), '{"summary":"ok","findings":[]}');
  });

  it('detects critical findings reliably', () => {
    const review = parseStructuredReview(
      JSON.stringify({
        summary: 'Issues found',
        findings: [
          { category: 'security', severity: 'warning', message: 'Minor' },
          { category: 'tests', severity: 'critical', message: 'No tests' },
        ],
      }),
    );
    assert.equal(hasCriticalFindings(review), true);
  });

  it('ignores invalid severity values', () => {
    const review = parseStructuredReview(
      JSON.stringify({
        summary: 'x',
        findings: [
          { category: 'security', severity: 'blocker', message: 'bad' },
          { category: 'security', severity: 'suggestion', message: 'ok' },
        ],
      }),
    );
    assert.equal(review.findings.length, 1);
  });
});
