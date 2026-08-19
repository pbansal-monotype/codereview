import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldIgnoreFile, filterDiffByFiles, isAllowedFile } from '../filter';
import { partitionFiles } from '../github/pr-data';

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

describe('partitionFiles', () => {
  it('rejects files whose extension is not on the allowlist', () => {
    const { reviewedFiles, ignoredFiles, disallowedFiles } = partitionFiles(
      ['src/index.ts', 'assets/logo.psd', 'notes.md'],
      [],
    );

    assert.deepEqual(reviewedFiles, ['src/index.ts']);
    assert.deepEqual(disallowedFiles, ['assets/logo.psd', 'notes.md']);
    // Disallowed files must also land in ignoredFiles so they are stripped from the diff.
    assert.deepEqual(ignoredFiles, ['assets/logo.psd', 'notes.md']);
  });

  it('reports extension rejections separately from ignore-pattern matches', () => {
    const { ignoredFiles, disallowedFiles } = partitionFiles(
      ['package-lock.json', 'assets/logo.psd'],
      [],
    );

    assert.deepEqual(disallowedFiles, ['assets/logo.psd']);
    assert.deepEqual(ignoredFiles.sort(), ['assets/logo.psd', 'package-lock.json']);
  });

  it('keeps allowed files that no ignore pattern matches', () => {
    const { reviewedFiles, ignoredFiles, disallowedFiles } = partitionFiles(
      ['src/auth/login.ts', 'Dockerfile', 'go.mod', '.env.example'],
      [],
    );

    assert.deepEqual(reviewedFiles, ['src/auth/login.ts', 'Dockerfile', 'go.mod', '.env.example']);
    assert.deepEqual(ignoredFiles, []);
    assert.deepEqual(disallowedFiles, []);
  });

  it('still honours custom ignore patterns for allowed extensions', () => {
    const { reviewedFiles, disallowedFiles } = partitionFiles(
      ['src/generated/api.ts', 'src/app.ts'],
      ['**/generated/**'],
    );

    assert.deepEqual(reviewedFiles, ['src/app.ts']);
    assert.deepEqual(disallowedFiles, []);
  });
});

describe('isAllowedFile', () => {
  it('allows every file type declared reviewable by FILE_RULES', () => {
    for (const path of [
      'package.json',
      'requirements.txt',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'Gemfile',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'Dockerfile',
      'main.tf',
      'schema.sql',
      '.env.example',
    ]) {
      assert.equal(isAllowedFile(path), true, `expected ${path} to be reviewable`);
    }
  });

  it('rejects binaries and unknown types', () => {
    assert.equal(isAllowedFile('assets/logo.psd'), false);
    assert.equal(isAllowedFile('LICENSE'), false);
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
