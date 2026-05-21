/**
 * Parse a unified diff to determine which new-file line numbers are valid
 * targets for inline PR review comments (i.e. lines that appear in diff hunks).
 *
 * Returns Map<filename, Set<valid line numbers on the RIGHT/new side>>.
 */
export declare function parseDiffForCommentTargets(diff: string): Map<string, Set<number>>;
