import type { StoredFinding } from './findings-state';
export interface FindingSuppression {
    dismissedFingerprints: Set<string>;
    /** Prior findings from the last successful review on this PR. */
    previousFindings?: StoredFinding[];
}
export declare function mergeDismissedFingerprints(persisted: string[] | undefined, fromComments: Set<string>): string[];
/** Prompt block telling specialists not to re-report dismissed or fixed issues. */
export declare function buildSuppressionPromptBlock(suppression: FindingSuppression | undefined): string;
//# sourceMappingURL=suppression.d.ts.map