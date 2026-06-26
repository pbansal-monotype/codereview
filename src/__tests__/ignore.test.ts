import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldIgnoreFile, filterDiffByFiles } from '../filter';

describe('shouldIgnoreFile', () => {
  it('ignores lockfiles by default', () => {
    assert.equal(shouldIgnoreFile('package-lock.json', []), true);
    assert.equal(shouldIgnoreFile('yarn.lock', []), true);
  });

  it('ignores dist paths', () => {
    assert.equal(shouldIgnoreFile('dist/index.js', []), true);
  });

  it('does not ignore source files', () => {
    assert.equal(shouldIgnoreFile('src/index.ts', []), false);
  });

  it('respects custom patterns', () => {
    assert.equal(
      shouldIgnoreFile('src/generated/foo.ts', ['**/generated/**']),
      true,
    );
  });

  it('ignores mocks and test fixtures', () => {
    assert.equal(shouldIgnoreFile('__mocks__/module.js', []), true);
    assert.equal(shouldIgnoreFile('src/foo/__testdata__.js', []), true);
    assert.equal(shouldIgnoreFile('src/foo/__fixtures__/bar.js', []), true);
  });

  it('does not ignore .env.example — reviewed as diff-only via risk scorer', () => {
    assert.equal(shouldIgnoreFile('.env.example', []), false);
  });
});

describe('filterDiffByFiles', () => {
  it('removes diff chunks for ignored files', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '+change',
      'diff --git a/package-lock.json b/package-lock.json',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '+lock',
    ].join('\n');

    const filtered = filterDiffByFiles(diff, new Set(['package-lock.json']));
    assert.ok(filtered.includes('src/a.ts'));
    assert.ok(!filtered.includes('package-lock.json'));
  });
});
