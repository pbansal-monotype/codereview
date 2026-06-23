export type Severity = 'critical' | 'warning' | 'suggestion';
export type Confidence = 'high' | 'medium' | 'low';
export interface Finding {
    category: string;
    severity: Severity;
    confidence: Confidence;
    file?: string;
    line?: number;
    /** Verbatim code excerpt — the ground truth for locating and verifying the issue. */
    codeSnippet?: string;
    message: string;
}
export interface StructuredReview {
    summary: string;
    findings: Finding[];
    /** True when the judge output was degraded (e.g. parse failure fallback) and findings have not been verified. */
    unverified?: boolean;
}
export interface ParseStructuredReviewOptions {
    /** When true (default), return at most MAX_FINDINGS after sorting. */
    capFindings?: boolean;
    /** When true (default), drop findings with vague phrasing. */
    filterVague?: boolean;
    /** When true (default), drop low-confidence findings. */
    filterLowConfidence?: boolean;
}
export declare function parseStructuredReview(raw: string, options?: ParseStructuredReviewOptions): StructuredReview;
/** Build the final review from deduplicated judge output. */
export declare function buildJudgeReviewFromDedup(findings: Finding[]): StructuredReview;
/**
 * Parse output from a specialist agent where category is known externally.
 * Simpler schema: { findings: [{ severity, confidence, file, line, message }] }
 */
export declare function parseSpecialistFindings(raw: string, categoryId: string): Finding[];
export declare function hasCriticalFindings(review: StructuredReview): boolean;
export declare function sortFindingsForReview(findings: Finding[]): Finding[];
/**
 * Parse output from the judge dedup agent.
 * Accepts { "findings": [...] } (required by OpenAI/Azure json_object mode) or a bare array.
 */
export declare function parseDedupedFindings(raw: string): Finding[];
/** Merge findings by category + file + line, keeping the highest-severity entry. */
export declare function mechanicalDedup(findings: Finding[]): Finding[];
/** Build a degraded review when the judge fails to parse after retry. */
export declare function buildUnverifiedFallback(findings: Finding[], reason: string): StructuredReview;
/**
 * Salvage complete finding objects from truncated judge JSON
 * (e.g. output cut off mid-array or mid-object).
 */
export declare function salvageTruncatedFindingsJson(raw: string): string | null;
export declare function extractJson(text: string): string;
export declare function formatFindingsMarkdown(structured: StructuredReview, categoryLabels: Record<string, string>): string;
