import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewContext, THRESHOLDS } from '../context/diff';
import {
  createToolContext,
  findReferences,
  searchText,
  readFile,
  fileImportsTarget,
} from '../context/on-demand/tools';

const LOW_RISK_DIFF =
  'diff --git a/docs/note.txt b/docs/note.txt\n' +
  '--- a/docs/note.txt\n+++ b/docs/note.txt\n@@ -1 +1 @@\n-old\n+new\n';

const HIGH_RISK_DIFF =
  'diff --git a/src/auth/handler.ts b/src/auth/handler.ts\n' +
  '--- a/src/auth/handler.ts\n+++ b/src/auth/handler.ts\n@@ -1,3 +1,4 @@\n' +
  ' import { validate } from "../util/helper";\n' +
  '+export function checkAuth() { return validate(); }\n';

describe('buildReviewContext scoring floor', () => {
  it('includes low-risk test files with at least diff-only context', () => {
    const testDiff =
      'diff --git a/src/foo.test.ts b/src/foo.test.ts\n' +
      '--- a/src/foo.test.ts\n+++ b/src/foo.test.ts\n@@ -1 +1 @@\n-old\n+new\n';

    const result = buildReviewContext(testDiff, {}, 50_000);
    assert.equal(result.includedFiles.length, 1);
    assert.equal(result.skippedFiles.length, 0);
    assert.ok(result.context.includes('<diff path="src/foo.test.ts">'));
    assert.ok(result.includedFiles[0].score < THRESHOLDS.HIGH_RISK);
  });

  it('gates full file content at HIGH_RISK threshold', () => {
    const contents = { 'src/auth/handler.ts': 'export function checkAuth() {}' };
    const result = buildReviewContext(HIGH_RISK_DIFF, contents, 50_000);
    const included = result.includedFiles.find((f) => f.filePath === 'src/auth/handler.ts');
    assert.ok(included);
    assert.equal(included!.mode, 'diff+content');
  });
});

describe('context tools', () => {
  const fileContents = {
    'src/util/helper.ts': 'export function validate() { return true; }\n',
    'src/auth/handler.ts':
      'import { validate } from "../util/helper";\nexport function checkAuth() { return validate(); }\n',
  };
  const ctx = createToolContext(fileContents);

  it('read_file returns cached content', () => {
    const content = readFile(ctx, 'src/util/helper.ts');
    assert.ok(content?.includes('validate'));
    assert.equal(readFile(ctx, 'src/util/helper.ts'), content);
  });

  it('find_references resolves TS imports semantically', () => {
    const refs = findReferences(ctx, 'validate', 'src/util/helper.ts');
    assert.ok(refs.some((r) => r.file === 'src/auth/handler.ts'));
    assert.ok(refs.some((r) => r.source === 'semantic'));
  });

  it('search_text finds pattern matches', () => {
    const results = searchText(ctx, 'checkAuth');
    assert.ok(results.length >= 1);
    assert.equal(results[0].source, 'text-match');
  });

  it('fileImportsTarget detects relative imports', () => {
    const imports = fileImportsTarget(
      fileContents['src/auth/handler.ts'],
      'src/auth/handler.ts',
      'src/util/helper.ts',
    );
    assert.equal(imports, true);
  });
});

describe('blast-radius context injection', () => {
  it('injects caller references for low-risk files referenced by high-risk callers', () => {
    const lowDiff =
      'diff --git a/src/models/user.ts b/src/models/user.ts\n' +
      '--- a/src/models/user.ts\n+++ b/src/models/user.ts\n@@ -1 +1 @@\n' +
      '-export function validate() { return true; }\n' +
      '+export function validate(x: string) { return x.length > 0; }\n';

    const contents = {
      'src/models/user.ts': 'export function validate(x: string) { return x.length > 0; }\n',
      'src/auth/handler.ts':
        'import { validate } from "../models/user";\nexport function checkAuth() { return validate("x"); }\n',
    };

    const authDiff =
      'diff --git a/src/auth/handler.ts b/src/auth/handler.ts\n' +
      '--- a/src/auth/handler.ts\n+++ b/src/auth/handler.ts\n@@ -1 +1 @@\n' +
      '-export function checkAuth() { return true; }\n' +
      '+export function checkAuth() { return validate("x"); }\n';

    const result = buildReviewContext(lowDiff + '\n' + authDiff, contents, 100_000);
    assert.ok(result.context.includes('<caller-references target="src/models/user.ts">'));
  });
});
