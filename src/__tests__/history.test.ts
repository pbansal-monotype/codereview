import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunRecord } from '../history/record';
import { SupabaseHistoryStore, RUNS_TABLE, FINDINGS_TABLE } from '../history/supabase';
import { createHistoryStore } from '../history';
import type { FetchLike } from '../history/supabase';
import type { BuildRecordInput } from '../history/record';
import { sanitizeErrorMessage } from '../sanitize';
import type { PullRequestData } from '../github';
import type { ReviewConfig } from '../config';
import type { Finding, StructuredReview } from '../output/findings';

// ─── Fixtures ──────────────────────────────────────────────────────

function makePR(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 42,
    title: 'Add caching layer',
    author: 'dev',
    body: '',
    headBranch: 'feature',
    baseBranch: 'main',
    headSha: 'abc1234',
    diff: 'diff --git a/src/foo.ts b/src/foo.ts',
    fileContents: [],
    reviewedFiles: ['src/foo.ts', 'src/bar.ts'],
    changedFiles: ['src/foo.ts', 'src/bar.ts', 'yarn.lock'],
    ignoredFiles: ['yarn.lock'],
    redactionCount: 0,
    isIncremental: false,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  return {
    provider: 'anthropic',
    apiKey: 'test',
    model: 'claude-3-5-sonnet-20241022',
    azureEndpoint: '',
    githubToken: 'test',
    categories: {
      security: { enabled: true, guidelines: 'sec' },
      code: { enabled: true, guidelines: 'code' },
      custom: { enabled: false, guidelines: '' },
    },
    repoContext: '',
    reviewPolicy: '',
    ignorePatterns: [],
    stateStore: 'none',
    stateGistId: '',
    incrementalReview: false,
    history: { supabaseUrl: '', supabaseKey: '' },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: 'security',
    severity: 'critical',
    confidence: 'high',
    file: 'src/foo.ts',
    line: 12,
    message: 'SQL injection via string interpolation',
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildRecordInput> = {}): BuildRecordInput {
  return {
    repo: 'acme/widgets',
    pr: makePR(),
    config: makeConfig(),
    categories: ['security', 'code'],
    inputTokens: 10_000,
    outputTokens: 2_000,
    apiCalls: 5,
    durationMs: 45_000,
    cached: false,
    ...overrides,
  };
}

function makeStructured(findings: Finding[]): StructuredReview {
  return { summary: 'ok', findings };
}

// ─── Record mapping ────────────────────────────────────────────────

describe('buildRunRecord', () => {
  it('maps PR and run metadata onto the run row', () => {
    const { run } = buildRunRecord(makeInput());

    assert.equal(run.repo, 'acme/widgets');
    assert.equal(run.pr_number, 42);
    assert.equal(run.head_sha, 'abc1234');
    assert.equal(run.base_branch, 'main');
    assert.equal(run.pr_author, 'dev');
    assert.equal(run.provider, 'anthropic');
    assert.deepEqual(run.categories, ['security', 'code']);
    assert.equal(run.changed_files_count, 3);
    assert.equal(run.reviewed_files_count, 2);
    assert.equal(run.ignored_files_count, 1);
    assert.equal(run.total_tokens, 12_000);
    assert.equal(run.api_calls, 5);
    assert.equal(run.duration_ms, 45_000);
    assert.equal(run.cached, false);
    assert.match(run.id, /^[0-9a-f-]{36}$/);
  });

  it('counts findings by severity', () => {
    const structured = makeStructured([
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'warning' }),
      makeFinding({ severity: 'suggestion' }),
    ]);
    const { run } = buildRunRecord(makeInput({ structured }));

    assert.equal(run.findings_count, 4);
    assert.equal(run.critical_count, 2);
    assert.equal(run.warning_count, 1);
    assert.equal(run.suggestion_count, 1);
  });

  it('links every finding row to the parent run and denormalizes PR identity', () => {
    const structured = makeStructured([makeFinding(), makeFinding({ file: 'src/bar.ts' })]);
    const { run, findings } = buildRunRecord(makeInput({ structured }));

    assert.equal(findings.length, 2);
    for (const f of findings) {
      assert.equal(f.run_id, run.id);
      assert.equal(f.repo, 'acme/widgets');
      assert.equal(f.pr_number, 42);
      assert.equal(f.head_sha, 'abc1234');
      assert.ok(f.fingerprint.length > 0, 'finding should carry a fingerprint');
    }
    // Distinct primary keys per finding.
    assert.notEqual(findings[0].id, findings[1].id);
  });

  it('records failed specialists and the unverified judge flag', () => {
    const { run } = buildRunRecord(
      makeInput({
        structured: { summary: 'ok', findings: [], unverified: true },
        specialistResults: [
          { categoryId: 'security', findings: [], tokens: { input: 0, output: 0 }, apiCalls: 0, failed: true, error: 'timeout' },
          { categoryId: 'code', findings: [], tokens: { input: 1, output: 1 }, apiCalls: 1, failed: false },
        ],
      }),
    );

    assert.deepEqual(run.failed_specialists, ['security']);
    assert.equal(run.judge_unverified, true);
  });

  it('nulls line and snippet when the finding has none', () => {
    const structured = makeStructured([
      makeFinding({ line: undefined, codeSnippet: undefined, file: undefined }),
    ]);
    const { findings } = buildRunRecord(makeInput({ structured }));

    assert.equal(findings[0].line, null);
    assert.equal(findings[0].code_snippet, null);
    assert.equal(findings[0].file, '');
  });

  it('estimates cost as a number for known models and null for unknown ones', () => {
    const known = buildRunRecord(makeInput()).run;
    assert.equal(typeof known.estimated_cost_usd, 'number');
    assert.ok((known.estimated_cost_usd ?? 0) > 0);

    const unknown = buildRunRecord(
      makeInput({ config: makeConfig({ model: 'some-unlisted-model' }) }),
    ).run;
    assert.equal(unknown.estimated_cost_usd, null);
  });

  it('parses GitHub run metadata, tolerating a non-numeric attempt', () => {
    const { run } = buildRunRecord(
      makeInput({
        githubContext: { runId: '123', runAttempt: 'not-a-number', actor: 'ci-bot', workflow: 'PR Review' },
      }),
    );

    assert.equal(run.github_run_id, '123');
    assert.equal(run.github_run_attempt, null);
    assert.equal(run.github_actor, 'ci-bot');
  });

  it('flags cached same-SHA replays so they can be excluded from cost analysis', () => {
    const { run } = buildRunRecord(makeInput({ cached: true, inputTokens: 0, outputTokens: 0 }));

    assert.equal(run.cached, true);
    assert.equal(run.total_tokens, 0);
  });
});

// ─── Store behavior ────────────────────────────────────────────────

function okResponse() {
  return { ok: true, status: 201, text: async () => '' };
}

describe('SupabaseHistoryStore', () => {
  it('posts the run before its findings, to satisfy the foreign key', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return okResponse();
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'sb_secret_key', fetchImpl);
    const { run, findings } = buildRunRecord(
      makeInput({ structured: makeStructured([makeFinding()]) }),
    );

    const id = await store.record(run, findings);

    assert.equal(id, run.id);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].endsWith(`/rest/v1/${RUNS_TABLE}`));
    assert.ok(calls[1].endsWith(`/rest/v1/${FINDINGS_TABLE}`));
  });

  it('sends auth headers and a JSON array body', async () => {
    const captured: Array<{ headers: Record<string, string>; body?: string }> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      captured.push(init);
      return okResponse();
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'sb_secret_abc', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    await store.record(run, []);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].headers.apikey, 'sb_secret_abc');
    assert.equal(captured[0].headers.Authorization, 'Bearer sb_secret_abc');
    assert.equal(captured[0].headers.Prefer, 'return=minimal');
    assert.ok(Array.isArray(JSON.parse(captured[0].body ?? '')));
  });

  it('skips the findings request entirely when there are none', async () => {
    let requests = 0;
    const fetchImpl: FetchLike = async () => {
      requests++;
      return okResponse();
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    await store.record(run, []);

    assert.equal(requests, 1);
  });

  it('resolves null instead of throwing when the database rejects the write', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => 'permission denied',
    });
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'bad-key', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    const id = await store.record(run, []);

    assert.equal(id, null, 'a rejected write must not fail the review');
  });

  it('resolves null instead of throwing when the network call blows up', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ENOTFOUND x.supabase.co');
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    assert.equal(await store.record(run, []), null);
  });

  it('normalizes a trailing slash in the project URL', async () => {
    let url = '';
    const fetchImpl: FetchLike = async (u) => {
      url = u;
      return okResponse();
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co/', 'k', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    await store.record(run, []);

    assert.equal(url, `https://x.supabase.co/rest/v1/${RUNS_TABLE}`);
  });

  it('does not prefix /rest/v1 for a local PostgREST origin', async () => {
    let url = '';
    const fetchImpl: FetchLike = async (u) => {
      url = u;
      return okResponse();
    };
    const store = new SupabaseHistoryStore('http://127.0.0.1:54321', 'k', fetchImpl);
    const { run } = buildRunRecord(makeInput());

    await store.record(run, []);

    assert.equal(url, `http://127.0.0.1:54321/${RUNS_TABLE}`);
  });

  it('chunks large finding sets into multiple requests', async () => {
    const bodies: number[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body ?? '').length);
      return okResponse();
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    const many = Array.from({ length: 1200 }, (_, i) => makeFinding({ line: i }));
    const { run, findings } = buildRunRecord(makeInput({ structured: makeStructured(many) }));

    await store.record(run, findings);

    // 1 run row + 500 + 500 + 200 findings.
    assert.deepEqual(bodies, [1, 500, 500, 200]);
  });

  it('findReviewForSha returns findings from the latest uncached run of that commit', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes(RUNS_TABLE) && url.includes('head_sha=')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([
              { id: 'cached-run', cached: true },
              { id: 'fresh-run', cached: false },
            ]),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 'f1',
              run_id: 'fresh-run',
              repo: 'a/b',
              pr_number: 1,
              head_sha: 'abc',
              fingerprint: 'code|x|y',
              category: 'code',
              severity: 'warning',
              confidence: 'high',
              file: 'x.ts',
              line: 3,
              code_snippet: 'foo',
              message: 'y',
            },
          ]),
      };
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    const hit = await store.findReviewForSha('a/b', 1, 'abc');
    assert.equal(hit?.runId, 'fresh-run');
    assert.equal(hit?.findings.length, 1);
    assert.equal(hit?.findings[0].file, 'x.ts');
  });

  it('findReviewForSha sends no request body — Node fetch rejects a GET that carries one', async () => {
    const inits: Array<{ method: string; body?: string }> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      inits.push(init);
      return { ok: true, status: 200, text: async () => '[]' };
    };
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    await store.findReviewForSha('a/b', 1, 'abc');

    assert.equal(inits.length, 1);
    assert.equal(inits[0].method, 'GET');
    assert.equal(inits[0].body, undefined);
  });

  it('findReviewForSha resolves null when no prior run exists', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '[]',
    });
    const store = new SupabaseHistoryStore('https://x.supabase.co', 'k', fetchImpl);
    assert.equal(await store.findReviewForSha('a/b', 1, 'abc'), null);
  });
});

describe('createHistoryStore', () => {
  it('returns null when neither url nor key is configured', () => {
    assert.equal(createHistoryStore({ supabaseUrl: '', supabaseKey: '' }), null);
  });

  it('returns null when only one half is configured', () => {
    assert.equal(createHistoryStore({ supabaseUrl: 'https://x.supabase.co', supabaseKey: '' }), null);
    assert.equal(createHistoryStore({ supabaseUrl: '', supabaseKey: 'k' }), null);
  });

  it('returns a store when fully configured', () => {
    const store = createHistoryStore({
      supabaseUrl: 'https://x.supabase.co',
      supabaseKey: 'sb_secret_k',
    });
    assert.ok(store instanceof SupabaseHistoryStore);
  });
});

describe('supabase key redaction', () => {
  it('redacts sb_secret keys from error text', () => {
    const out = sanitizeErrorMessage('failed with key sb_secret_abcdefghijklmnop123');
    assert.ok(!out.includes('abcdefghijklmnop'), out);
    assert.match(out, /sb_\*\*\*/);
  });

  it('redacts legacy service_role JWT keys from error text', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc123signature';
    const out = sanitizeErrorMessage(`insert failed: ${jwt}`);
    assert.ok(!out.includes('c2VydmljZV9yb2xl'), out);
    assert.match(out, /eyJ\*\*\*/);
  });
});
