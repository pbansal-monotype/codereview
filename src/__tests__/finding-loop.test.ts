import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingFingerprint,
  filterDismissedFindings,
  type Finding,
} from '../output/findings';
import {
  buildSuppressionPromptBlock,
  mergeDismissedFingerprints,
} from '../state/suppression';
import { toStoredFinding } from '../state/findings-state';
import {
  DISMISS_REPLY_RE,
  DISMISS_MARKER_RE,
  FINDING_MARKER_RE,
} from '../github/dismissals';

const sampleFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: 'security',
  severity: 'warning',
  confidence: 'high',
  file: 'src/auth.ts',
  line: 10,
  message: 'Missing auth check → unauthorized access → add middleware',
  ...overrides,
});

describe('findingFingerprint', () => {
  it('is stable for the same finding', () => {
    const a = sampleFinding();
    const b = sampleFinding({ line: 12 });
    assert.equal(findingFingerprint(a), findingFingerprint(b));
  });

  it('differs when message or file changes', () => {
    const a = findingFingerprint(sampleFinding());
    const b = findingFingerprint(sampleFinding({ file: 'src/other.ts' }));
    const c = findingFingerprint(
      sampleFinding({ message: 'SQL injection → data leak → parameterize' }),
    );
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});

describe('filterDismissedFindings', () => {
  it('removes findings matching dismissed fingerprints', () => {
    const f = sampleFinding();
    const fp = findingFingerprint(f);
    const kept = filterDismissedFindings(
      [f, sampleFinding({ file: 'src/api.ts' })],
      new Set([fp]),
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].file, 'src/api.ts');
  });
});

describe('mergeDismissedFingerprints', () => {
  it('unions persisted and new dismissals', () => {
    const merged = mergeDismissedFingerprints(['a'], new Set(['b', 'a']));
    assert.deepEqual(merged.sort(), ['a', 'b']);
  });
});

describe('buildSuppressionPromptBlock', () => {
  it('includes dismissed and prior findings', () => {
    const stored = toStoredFinding(sampleFinding());
    const block = buildSuppressionPromptBlock({
      dismissedFingerprints: new Set([stored.fingerprint]),
      previousFindings: [stored],
    });
    assert.match(block, /Finding suppression/);
    assert.match(block, /Dismissed by reviewer/);
    assert.match(block, /src\/auth\.ts/);
  });

  it('returns empty when nothing to suppress', () => {
    assert.equal(buildSuppressionPromptBlock(undefined), '');
    assert.equal(
      buildSuppressionPromptBlock({ dismissedFingerprints: new Set() }),
      '',
    );
  });
});

describe('dismissal patterns', () => {
  it('matches /dismiss replies', () => {
    assert.ok(DISMISS_REPLY_RE.test('/dismiss'));
    assert.ok(DISMISS_REPLY_RE.test("won't fix"));
    assert.ok(!DISMISS_REPLY_RE.test('/dismiss something else'));
  });

  it('parses finding and dismiss markers', () => {
    const body = 'issue\n<!-- ai-pr-finding: security|src/a.ts|missing auth -->';
    assert.equal(body.match(FINDING_MARKER_RE)?.[1], 'security|src/a.ts|missing auth');
    assert.equal(
      '<!-- ai-pr-dismiss: fp-1 -->'.match(DISMISS_MARKER_RE)?.[1],
      'fp-1',
    );
  });
});
