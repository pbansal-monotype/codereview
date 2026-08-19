import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseArgs,
  loadDotEnv,
  buildPullRequestData,
} from '../cli/local-review';
import type { Octokit } from '../github/client';

// ─── parseArgs ─────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses repo, PR number, and defaults debug to on', () => {
    const parsed = parseArgs(['--repo', 'owner/name', '--pr', '414']);
    assert.deepEqual(parsed, { repo: 'owner/name', pr: 414, debug: true, force: false });
  });

  it('honours --no-debug and the --debug / -d flags', () => {
    assert.equal(parseArgs(['--repo', 'a/b', '--pr', '1', '--no-debug']).debug, false);
    assert.equal(parseArgs(['--repo', 'a/b', '--pr', '1', '--no-debug', '--debug']).debug, true);
    assert.equal(parseArgs(['--repo', 'a/b', '--pr', '1', '--no-debug', '-d']).debug, true);
  });

  it('skips the -- argument separator used by npm/ts-node', () => {
    const parsed = parseArgs(['--', '--repo', 'acme/widgets', '--pr', '7']);
    assert.deepEqual(parsed, { repo: 'acme/widgets', pr: 7, debug: true, force: false });
  });

  it('honours --force / -f to bypass same-SHA cache', () => {
    assert.equal(parseArgs(['--repo', 'a/b', '--pr', '1', '--force']).force, true);
    assert.equal(parseArgs(['--repo', 'a/b', '--pr', '1', '-f']).force, true);
  });

  it('warns on unknown flags and hints when the unknown looks like a debug typo', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      parseArgs(['--repo', 'a/b', '--pr', '1', '--verbose']);
      parseArgs(['--repo', 'a/b', '--pr', '1', '--deubg']);
    } finally {
      console.warn = original;
    }

    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /unrecognized flag\(s\): --verbose/);
    assert.equal(warnings[0].includes('did you mean --debug?'), false);
    assert.match(warnings[1], /--deubg/);
    assert.match(warnings[1], /did you mean --debug\?/);
  });

  it('throws usage when --repo or --pr is missing', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      assert.throws(() => parseArgs([]), /Usage:.*--repo owner\/name --pr 123/);
      assert.throws(() => parseArgs(['--repo', 'a/b']), /Usage:/);
      assert.throws(() => parseArgs(['--pr', '1']), /Usage:/);
      assert.throws(() => parseArgs(['--repo']), /Usage:/);
      assert.throws(() => parseArgs(['--pr']), /Usage:/);
    } finally {
      console.warn = original;
    }
  });

  it('rejects non-positive or non-integer --pr values', () => {
    assert.throws(() => parseArgs(['--repo', 'a/b', '--pr', '0']), {
      message: 'Invalid --pr value: "0"',
    });
    assert.throws(() => parseArgs(['--repo', 'a/b', '--pr', '-3']), {
      message: 'Invalid --pr value: "-3"',
    });
    assert.throws(() => parseArgs(['--repo', 'a/b', '--pr', '1.5']), {
      message: 'Invalid --pr value: "1.5"',
    });
    assert.throws(() => parseArgs(['--repo', 'a/b', '--pr', 'abc']), {
      message: 'Invalid --pr value: "abc"',
    });
  });
});

// ─── loadDotEnv ────────────────────────────────────────────────────

function withTempEnvFile(contents: string, fn: (envPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-review-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, contents, 'utf8');
  try {
    fn(envPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withEnv(keys: string[], fn: () => void): void {
  const prev = new Map(keys.map((k) => [k, process.env[k]]));
  try {
    fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('loadDotEnv', () => {
  it('is a no-op when the file does not exist', () => {
    withEnv(['LOCAL_REVIEW_MISSING'], () => {
      delete process.env.LOCAL_REVIEW_MISSING;
      loadDotEnv(path.join(os.tmpdir(), 'definitely-not-an-env-file-' + Date.now()));
      assert.equal(process.env.LOCAL_REVIEW_MISSING, undefined);
    });
  });

  it('loads KEY=VALUE pairs and skips blanks, comments, and malformed lines', () => {
    withTempEnvFile(
      [
        '',
        '# comment',
        '  # indented comment',
        'LOCAL_REVIEW_A=alpha',
        '  LOCAL_REVIEW_B = beta  ',
        'not-an-assignment',
        '=no-key',
        'LOCAL_REVIEW_C=',
      ].join('\n'),
      (envPath) => {
        withEnv(['LOCAL_REVIEW_A', 'LOCAL_REVIEW_B', 'LOCAL_REVIEW_C'], () => {
          delete process.env.LOCAL_REVIEW_A;
          delete process.env.LOCAL_REVIEW_B;
          delete process.env.LOCAL_REVIEW_C;
          loadDotEnv(envPath);
          assert.equal(process.env.LOCAL_REVIEW_A, 'alpha');
          assert.equal(process.env.LOCAL_REVIEW_B, 'beta');
          assert.equal(process.env.LOCAL_REVIEW_C, '');
        });
      },
    );
  });

  it('does not overwrite variables already set in the environment', () => {
    withTempEnvFile('LOCAL_REVIEW_KEEP=from-file\n', (envPath) => {
      withEnv(['LOCAL_REVIEW_KEEP'], () => {
        process.env.LOCAL_REVIEW_KEEP = 'already-set';
        loadDotEnv(envPath);
        assert.equal(process.env.LOCAL_REVIEW_KEEP, 'already-set');
      });
    });
  });
});

// ─── buildPullRequestData ──────────────────────────────────────────

interface FakePr {
  title: string;
  body: string | null;
  base: { ref: string };
  head: { ref: string; sha: string };
  user: { login: string } | null;
}

function makeOctokit(opts: {
  pr?: Partial<FakePr>;
  diff?: string;
  files?: string[];
  fileContents?: Record<string, string>;
  getError?: Error;
}): Octokit {
  const files = opts.files ?? ['src/index.ts'];
  const pr: FakePr = {
    title: 'Fix login',
    body: 'details',
    base: { ref: 'main' },
    head: { ref: 'feat', sha: 'abc1234' },
    user: { login: 'alice' },
    ...opts.pr,
  };

  return {
    rest: {
      pulls: {
        get: async (params: { mediaType?: { format?: string } }) => {
          if (opts.getError) throw opts.getError;
          if (params.mediaType?.format === 'diff') {
            return { data: opts.diff ?? 'diff --git a/src/index.ts b/src/index.ts\n' };
          }
          return { data: pr };
        },
        listFiles: async ({ page, per_page }: { page: number; per_page: number }) => {
          const start = (page - 1) * per_page;
          return {
            data: files.slice(start, start + per_page).map((filename) => ({ filename })),
          };
        },
      },
      repos: {
        getContent: async ({ path: filePath }: { path: string }) => {
          const content = opts.fileContents?.[filePath];
          if (content === undefined) {
            throw Object.assign(new Error('Not Found'), { status: 404 });
          }
          return {
            data: {
              type: 'file',
              content: Buffer.from(content, 'utf8').toString('base64'),
            },
            headers: {},
          };
        },
      },
    },
  } as unknown as Octokit;
}

describe('buildPullRequestData', () => {
  it('maps GitHub PR metadata, files, and contents onto PullRequestData', async () => {
    const octokit = makeOctokit({
      files: ['src/index.ts', 'yarn.lock'],
      fileContents: { 'src/index.ts': 'export const x = 1;\n' },
      diff: 'diff --git a/src/index.ts b/src/index.ts\n+export const x = 1;\n',
    });

    const data = await buildPullRequestData('acme/widgets', 414, 'token', [], octokit);

    assert.equal(data.number, 414);
    assert.equal(data.title, 'Fix login');
    assert.equal(data.body, 'details');
    assert.equal(data.baseBranch, 'main');
    assert.equal(data.headBranch, 'feat');
    assert.equal(data.headSha, 'abc1234');
    assert.equal(data.author, 'alice');
    assert.deepEqual(data.changedFiles, ['src/index.ts', 'yarn.lock']);
    assert.deepEqual(data.reviewedFiles, ['src/index.ts']);
    assert.ok(data.ignoredFiles.includes('yarn.lock'));
    assert.equal(data.isIncremental, false);
    assert.equal(data.incrementalBaseSha, undefined);
    assert.equal(data.fileContents.length, 1);
    assert.equal(data.fileContents[0].path, 'src/index.ts');
    assert.match(data.diff, /src\/index\.ts/);
  });

  it('fills empty body and unknown author when GitHub omits them', async () => {
    const octokit = makeOctokit({
      pr: { body: null, user: null },
      files: ['src/app.ts'],
    });

    const data = await buildPullRequestData('owner/name', 1, 'token', [], octokit);

    assert.equal(data.body, '');
    assert.equal(data.author, 'unknown');
  });

  it('paginates listFiles until a short page', async () => {
    const files = Array.from({ length: 101 }, (_, i) => `src/f${i}.ts`);
    const octokit = makeOctokit({ files });

    const data = await buildPullRequestData('owner/name', 2, 'token', [], octokit);

    assert.equal(data.changedFiles.length, 101);
    assert.equal(data.changedFiles[0], 'src/f0.ts');
    assert.equal(data.changedFiles[100], 'src/f100.ts');
  });

  it('rejects a repo slug that is not owner/name', async () => {
    await assert.rejects(
      () => buildPullRequestData('not-a-slug', 1, 'token', [], makeOctokit({})),
      { message: 'Invalid --repo value: "not-a-slug". Expected owner/name.' },
    );
    await assert.rejects(
      () => buildPullRequestData('owner/', 1, 'token', [], makeOctokit({})),
      /Invalid --repo value/,
    );
  });

  it('propagates GitHub API failures', async () => {
    const octokit = makeOctokit({ getError: new Error('Not Found') });
    await assert.rejects(
      () => buildPullRequestData('owner/name', 999, 'token', [], octokit),
      { message: 'Not Found' },
    );
  });
});
