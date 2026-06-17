import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffForCommentTargets } from '../context/diff';

describe('parseDiffForCommentTargets', () => {
  it('extracts valid line numbers from a simple diff', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@',
      ' line 1',
      '+added line',
      ' line 2',
      ' line 3',
    ].join('\n');

    const targets = parseDiffForCommentTargets(diff);
    const lines = targets.get('src/app.ts');
    assert.ok(lines);
    assert.ok(lines.has(1)); // context
    assert.ok(lines.has(2)); // added
    assert.ok(lines.has(3)); // context
    assert.ok(lines.has(4)); // context
  });

  it('does not include deleted lines', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,4 +1,3 @@',
      ' line 1',
      '-deleted line',
      ' line 2',
      ' line 3',
    ].join('\n');

    const targets = parseDiffForCommentTargets(diff);
    const lines = targets.get('src/app.ts');
    assert.ok(lines);
    // deleted line doesn't get a new-file line number
    assert.equal(lines.size, 3); // lines 1, 2, 3
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,3 @@',
      ' line 1',
      '+new line',
      ' line 2',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -5,3 +5,3 @@',
      ' line 5',
      '-old line 6',
      '+new line 6',
      ' line 7',
    ].join('\n');

    const targets = parseDiffForCommentTargets(diff);
    assert.ok(targets.has('a.ts'));
    assert.ok(targets.has('b.ts'));
    assert.ok(targets.get('b.ts')!.has(6)); // replaced line
    assert.ok(targets.get('b.ts')!.has(5)); // context
  });

  it('handles multiple hunks in one file', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@',
      ' line 1',
      '-old',
      '+new',
      ' line 3',
      '@@ -10,3 +10,4 @@',
      ' line 10',
      '+added at 11',
      ' line 11',
      ' line 12',
    ].join('\n');

    const targets = parseDiffForCommentTargets(diff);
    const lines = targets.get('src/app.ts');
    assert.ok(lines);
    assert.ok(lines.has(2)); // replaced line in hunk 1
    assert.ok(lines.has(11)); // added line in hunk 2
  });

  it('returns empty map for non-diff input', () => {
    const targets = parseDiffForCommentTargets('not a diff');
    assert.equal(targets.size, 0);
  });
});
