import type { StoredFinding } from './findings-state';

export interface FindingSuppression {
  dismissedFingerprints: Set<string>;
  /** Prior findings from the last successful review on this PR. */
  previousFindings?: StoredFinding[];
}

export function mergeDismissedFingerprints(
  persisted: string[] | undefined,
  fromComments: Set<string>,
): string[] {
  return [...new Set([...(persisted ?? []), ...fromComments])];
}

/** Prompt block telling specialists not to re-report dismissed or fixed issues. */
export function buildSuppressionPromptBlock(
  suppression: FindingSuppression | undefined,
): string {
  if (!suppression) return '';

  const dismissed = suppression.dismissedFingerprints;
  const previous = suppression.previousFindings ?? [];

  const dismissedLines = previous
    .filter((f) => dismissed.has(f.fingerprint))
    .map((f) => `- [${f.category}] \`${f.file}\` — ${f.message}`);

  const priorOpen = previous
    .filter((f) => !dismissed.has(f.fingerprint))
    .map((f) => `- [${f.category}] \`${f.file}\` — ${f.message}`);

  if (dismissedLines.length === 0 && priorOpen.length === 0) return '';

  let block = '\n## Finding suppression\n';
  block +=
    'Do NOT re-report issues below unless the changed code in this diff clearly still has the same problem.\n';

  if (dismissedLines.length > 0) {
    block += '\n**Dismissed by reviewer (never re-report):**\n';
    block += dismissedLines.join('\n') + '\n';
  }

  if (priorOpen.length > 0) {
    block +=
      '\n**Reported on a prior review (likely fixed — only re-report if this diff still shows the issue):**\n';
    block += priorOpen.join('\n') + '\n';
  }

  return block;
}
