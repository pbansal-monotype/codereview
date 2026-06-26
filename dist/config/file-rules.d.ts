/**
 * Per-filetype review rules.
 * Each rule set provides focused guidance that supplements the category-level guidelines
 * when the reviewer encounters a file of that type.
 */
export interface FileRule {
    /** Glob patterns or extensions this rule applies to. */
    match: string[];
    /** Human-readable label for the file type. */
    label: string;
    /** Extra review instructions appended to the specialist prompt for matched files. */
    reviewHints: string;
    /** Risk weight multiplier (1.0 = normal, >1 = higher scrutiny). */
    riskWeight: number;
}
export declare const FILE_RULES: FileRule[];
/**
 * Look up all matching rules for a given file path.
 * Multiple rules may match (e.g. a .ts file inside a specific directory).
 */
export declare function getFileRules(filePath: string): FileRule[];
/** Compute the aggregate risk weight for a file based on matching rules. */
export declare function getFileRiskWeight(filePath: string): number;
/** Collect review hints for a file to inject into specialist prompts. */
export declare function getFileReviewHints(filePath: string): string;
//# sourceMappingURL=file-rules.d.ts.map