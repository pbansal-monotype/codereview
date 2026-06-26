import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFile, THRESHOLDS } from '../context/diff';

const SMALL_DIFF = 'diff --git a/f b/f\n+line\n';

describe('scoreFile', () => {
  it('caps test files below medium risk for non-test specialists', () => {
    const score = scoreFile('src/router/healthcheck/get/index.test.js', SMALL_DIFF);
    assert.ok(score < THRESHOLDS.MEDIUM_RISK);
  });

  it('gives test files a low fixed score', () => {
    const score = scoreFile(
      'src/router/healthcheck/get/index.test.js',
      SMALL_DIFF,
    );
    assert.ok(score < THRESHOLDS.MEDIUM_RISK);
  });

  it('scores implementation files above test files for non-test specialists', () => {
    const impl = scoreFile('src/lib/initWfgFromConfig.js', SMALL_DIFF);
    const test = scoreFile('src/lib/initWfgFromConfig.test.js', SMALL_DIFF);
    assert.ok(impl > test);
    assert.ok(impl >= THRESHOLDS.MEDIUM_RISK);
  });

  it('does not penalize docker-compose with the docs pattern', () => {
    const score = scoreFile('docker-compose.yml', SMALL_DIFF);
    assert.ok(score >= THRESHOLDS.MEDIUM_RISK);
  });

  it('scores .env.example for diff-only, not diff+content', () => {
    const score = scoreFile('.env.example', SMALL_DIFF);
    assert.ok(score >= THRESHOLDS.MEDIUM_RISK);
    assert.ok(score < THRESHOLDS.HIGH_RISK);
  });

  it('boosts new unpatterned source files into high-risk (diff+content)', () => {
    const modified = scoreFile('src/lib/initWfgFromConfig.js', SMALL_DIFF);
    const added = scoreFile('src/lib/initWfgFromConfig.js', SMALL_DIFF, { isNew: true });
    assert.ok(modified < THRESHOLDS.HIGH_RISK);
    assert.ok(added >= THRESHOLDS.HIGH_RISK);
    assert.ok(added > modified);
  });

  it('does not promote new .env.example to diff+content', () => {
    const score = scoreFile('.env.example', SMALL_DIFF, { isNew: true });
    assert.ok(score < THRESHOLDS.HIGH_RISK);
  });
});
