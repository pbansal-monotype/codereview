import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredReview,
  parseSpecialistFindings,
  parseDedupedFindings,
  hasCriticalFindings,
  extractJson,
  sortFindingsForReview,
  salvageTruncatedFindingsJson,
  mechanicalDedup,
  buildUnverifiedFallback,
  buildJudgeReviewFromDedup,
} from '../findings';

describe('parseStructuredReview', () => {
  it('parses valid JSON with confidence field', () => {
    const raw = JSON.stringify({
      summary: 'Looks good',
      findings: [
        {
          category: 'security',
          severity: 'critical',
          confidence: 'high',
          file: 'src/auth.ts',
          line: 10,
          message: 'Hardcoded password "admin123" in login handler → allows unauthorized access → use env var or secrets manager',
        },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.summary, 'Looks good');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].severity, 'critical');
    assert.equal(result.findings[0].confidence, 'high');
  });

  it('defaults confidence to medium when missing', () => {
    const raw = JSON.stringify({
      summary: 'ok',
      findings: [
        {
          category: 'security',
          severity: 'warning',
          file: 'src/api.ts',
          line: 5,
          message: 'SQL query built with string concatenation → injection risk → use parameterised queries',
        },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.findings[0].confidence, 'medium');
  });

  it('filters out low-confidence findings', () => {
    const raw = JSON.stringify({
      summary: 'ok',
      findings: [
        {
          category: 'security',
          severity: 'warning',
          confidence: 'low',
          file: 'src/api.ts',
          line: 5,
          message: 'Possible injection risk in query builder',
        },
        {
          category: 'security',
          severity: 'warning',
          confidence: 'high',
          file: 'src/api.ts',
          line: 10,
          message: 'User input concatenated into SQL → injection → use parameterised queries',
        },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].confidence, 'high');
  });

  it('filters out vague findings starting with "Ensure"', () => {
    const raw = JSON.stringify({
      summary: 'ok',
      findings: [
        {
          category: 'security',
          severity: 'warning',
          file: 'src/auth.ts',
          line: 5,
          message: 'Ensure error handling properly sanitizes output to prevent information leakage',
        },
        {
          category: 'security',
          severity: 'warning',
          file: 'src/auth.ts',
          line: 10,
          message: 'Stack trace logged with user PII at line 10 → leaks sensitive data in production → strip PII before logging',
        },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].line, 10);
  });

  it('filters out findings without a file path', () => {
    const raw = JSON.stringify({
      summary: 'ok',
      findings: [
        { category: 'security', severity: 'warning', message: 'Generic finding without location' },
        { category: 'security', severity: 'warning', file: 'src/api.ts', line: 5, message: 'Specific finding with location → risk → fix' },
      ],
    });
    const result = parseStructuredReview(raw);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].file, 'src/api.ts');
  });

  it('does not cap findings by default and prioritises by severity', () => {
    const findings = [];
    for (let i = 0; i < 12; i++) {
      findings.push({
        category: 'tests',
        severity: i < 2 ? 'critical' : 'suggestion',
        confidence: 'high',
        file: `src/file${i}.ts`,
        line: i + 1,
        message: `Issue number ${i} in the code → causes problem → fix it this way`,
      });
    }
    const result = parseStructuredReview(JSON.stringify({ summary: 'many issues', findings }));
    assert.equal(result.findings.length, 12);
    assert.equal(result.findings[0].severity, 'critical');
    assert.equal(result.findings[1].severity, 'critical');
  });

  it('does not cap findings when capFindings is false', () => {
    const findings = [];
    for (let i = 0; i < 12; i++) {
      findings.push({
        category: 'tests',
        severity: 'suggestion',
        confidence: 'high',
        file: `src/file${i}.ts`,
        line: i + 1,
        message: `Issue number ${i} in the code → causes problem → fix it this way`,
      });
    }
    const result = parseStructuredReview(JSON.stringify({ summary: 'many issues', findings }), {
      capFindings: false,
    });
    assert.equal(result.findings.length, 12);
  });

  it('extracts JSON from markdown fences', () => {
    const raw = '```json\n{"summary":"ok","findings":[]}\n```';
    assert.equal(extractJson(raw), '{"summary":"ok","findings":[]}');
  });

  it('extracts JSON arrays from markdown fences', () => {
    const raw = '```json\n[{"category":"security","severity":"warning","file":"src/a.ts","message":"x"}]\n```';
    assert.equal(
      extractJson(raw),
      '[{"category":"security","severity":"warning","file":"src/a.ts","message":"x"}]',
    );
  });

  it('detects critical findings reliably', () => {
    const review = parseStructuredReview(
      JSON.stringify({
        summary: 'Issues found',
        findings: [
          { category: 'security', severity: 'warning', file: 'src/a.ts', line: 1, message: 'Minor issue in handler → may fail → add null check' },
          { category: 'tests', severity: 'critical', file: 'src/b.ts', line: 2, message: 'No tests for auth bypass → security gap → add test' },
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
          { category: 'security', severity: 'blocker', file: 'src/a.ts', line: 1, message: 'bad finding' },
          { category: 'security', severity: 'suggestion', file: 'src/b.ts', line: 2, message: 'ok finding with detail → risk → fix' },
        ],
      }),
    );
    assert.equal(review.findings.length, 1);
  });
});

describe('parseDedupedFindings', () => {
  it('parses a bare JSON array of findings', () => {
    const raw = JSON.stringify([
      {
        category: 'security',
        severity: 'critical',
        confidence: 'high',
        file: 'src/auth.ts',
        line: 10,
        codeSnippet: 'const x = 1;',
        message: 'Missing auth check',
      },
    ]);
    const findings = parseDedupedFindings(raw);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'security');
    assert.equal(findings[0].codeSnippet, 'const x = 1;');
  });

  it('parses a { findings: [...] } object', () => {
    const raw = JSON.stringify({
      findings: [
        {
          category: 'security',
          severity: 'critical',
          confidence: 'high',
          file: 'src/auth.ts',
          line: 10,
          codeSnippet: 'const x = 1;',
          message: 'Missing auth check',
        },
      ],
    });
    const findings = parseDedupedFindings(raw);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'security');
  });

  it('throws when output has no findings array', () => {
    assert.throws(
      () => parseDedupedFindings('{"summary":"ok"}'),
      /findings/i,
    );
  });
});

describe('sortFindingsForReview', () => {
  it('sorts by severity then file path', () => {
    const sorted = sortFindingsForReview([
      { category: 'code', severity: 'warning', confidence: 'high', file: 'src/z.ts', message: 'a' },
      { category: 'code', severity: 'critical', confidence: 'high', file: 'src/b.ts', message: 'b' },
      { category: 'code', severity: 'warning', confidence: 'high', file: 'src/a.ts', message: 'c' },
    ]);
    assert.deepEqual(sorted.map((f) => `${f.severity}:${f.file}`), [
      'critical:src/b.ts',
      'warning:src/a.ts',
      'warning:src/z.ts',
    ]);
  });
});

describe('buildJudgeReviewFromDedup', () => {
  it('summarizes all deduped findings without capping', () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({
      category: 'code',
      severity: (i === 0 ? 'critical' : 'warning') as 'critical' | 'warning',
      confidence: 'high' as const,
      file: `src/file${i}.ts`,
      line: i + 1,
      message: `Issue ${i}`,
    }));
    const review = buildJudgeReviewFromDedup(findings);
    assert.equal(review.findings.length, 12);
    assert.match(review.summary, /12 issue\(s\): 1 critical, 11 warning/);
  });
});

describe('parseStructuredReview sort order', () => {
  it('sorts by severity then file path', () => {
    const review = parseStructuredReview(
      JSON.stringify({
        summary: 'Issues',
        findings: [
          { category: 'code', severity: 'warning', confidence: 'high', file: 'src/z.ts', message: 'Issue z → risk → fix' },
          { category: 'code', severity: 'critical', confidence: 'high', file: 'src/b.ts', message: 'Issue b → risk → fix' },
          { category: 'code', severity: 'warning', confidence: 'high', file: 'src/a.ts', message: 'Issue a → risk → fix' },
        ],
      }),
    );
    assert.deepEqual(review.findings.map((f) => f.file), ['src/b.ts', 'src/a.ts', 'src/z.ts']);
  });
});

describe('parseSpecialistFindings', () => {
  it('parses specialist output and injects category', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'warning',
          confidence: 'high',
          file: 'src/db.ts',
          line: 15,
          message: 'Query inside for loop → N+1 → batch the query',
        },
      ],
    });
    const findings = parseSpecialistFindings(raw, 'performance');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'performance');
    assert.equal(findings[0].severity, 'warning');
    assert.equal(findings[0].confidence, 'high');
    assert.equal(findings[0].file, 'src/db.ts');
  });

  it('filters vague findings from specialist output', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'suggestion',
          confidence: 'medium',
          file: 'src/api.ts',
          line: 5,
          message: 'Consider adding caching for the response',
        },
        {
          severity: 'warning',
          confidence: 'high',
          file: 'src/api.ts',
          line: 20,
          message: 'SELECT * without LIMIT on user-facing endpoint → unbounded result set → add LIMIT clause',
        },
      ],
    });
    const findings = parseSpecialistFindings(raw, 'performance');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 20);
  });

  it('filters findings without file path', () => {
    const raw = JSON.stringify({
      findings: [
        { severity: 'warning', message: 'Missing auth check' },
        { severity: 'warning', file: 'src/route.ts', line: 3, message: 'No auth middleware on POST /users → unauthenticated access → add authMiddleware' },
      ],
    });
    const findings = parseSpecialistFindings(raw, 'security');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'src/route.ts');
  });

  it('returns empty array when specialist finds no issues', () => {
    const raw = JSON.stringify({ findings: [] });
    const findings = parseSpecialistFindings(raw, 'tests');
    assert.equal(findings.length, 0);
  });

  it('handles markdown-fenced JSON from specialist', () => {
    const raw = '```json\n{"findings":[{"severity":"critical","confidence":"high","file":"src/auth.ts","line":1,"message":"Hardcoded secret → exposure → use env var"}]}\n```';
    const findings = parseSpecialistFindings(raw, 'security');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'security');
    assert.equal(findings[0].severity, 'critical');
  });
});

describe('salvageTruncatedFindingsJson', () => {
  it('salvages complete objects from truncated findings array', () => {
    const complete = {
      category: 'security',
      severity: 'critical',
      confidence: 'high',
      file: 'src/a.ts',
      line: 1,
      message: 'Issue A',
    };
    const truncated = `Here is the review:\n{"findings":[${JSON.stringify(complete)},{"category":"code","severity":"warning","file":"src/b.ts","line":2,"mess`;
    const salvaged = salvageTruncatedFindingsJson(truncated);
    assert.ok(salvaged);
    const findings = parseDedupedFindings(salvaged!);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'src/a.ts');
  });

  it('parses prose-wrapped JSON via salvage path', () => {
    const raw =
      'Sure! Here is the JSON:\n```json\n{"summary":"ok","findings":[{"category":"security","severity":"warning","confidence":"high","file":"src/x.ts","line":3,"message":"msg"}]}\n```\nHope that helps!';
    const review = parseStructuredReview(raw);
    assert.equal(review.findings.length, 1);
    assert.equal(review.summary, 'ok');
  });
});

describe('mechanicalDedup', () => {
  it('keeps highest severity for same category+file+line', () => {
    const deduped = mechanicalDedup([
      { category: 'security', severity: 'warning', confidence: 'high', file: 'src/a.ts', line: 10, message: 'warn' },
      { category: 'security', severity: 'critical', confidence: 'high', file: 'src/a.ts', line: 10, message: 'crit' },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].severity, 'critical');
  });
});

describe('buildUnverifiedFallback', () => {
  it('marks dedup fallback as unverified', () => {
    const review = buildUnverifiedFallback(
      [
        { category: 'code', severity: 'warning', confidence: 'high', file: 'src/a.ts', line: 1, message: 'a' },
      ],
      'parse error',
    );
    assert.equal(review.unverified, true);
    assert.match(review.summary, /dedup failed/i);
  });
});
