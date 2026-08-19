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
/**
 * Stable id for a finding across review runs (line numbers may shift).
 * Used for dismissal tracking and same-issue suppression.
 */
export declare function findingFingerprint(f: Finding): string;
/** Drop findings whose fingerprint was dismissed by a reviewer. */
export declare function filterDismissedFindings(findings: Finding[], dismissed: Set<string>): Finding[];
export interface ParseStructuredReviewOptions {
    /**
     * @deprecated Findings are no longer capped; this option is ignored.
     */
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
/**
 * Validate and normalize already-parsed specialist findings.
 * Every specialist path must run findings through this — the tool loop returns
 * pre-parsed objects, so it cannot rely on parseSpecialistFindings above.
 */
export declare function sanitizeSpecialistFindings(items: unknown, categoryId: string): Finding[];
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
//# sourceMappingURL=findings.d.ts.map