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
export declare function parseStructuredReview(raw: string): StructuredReview;
/**
 * Parse output from a specialist agent where category is known externally.
 * Simpler schema: { findings: [{ severity, confidence, file, line, message }] }
 */
export declare function parseSpecialistFindings(raw: string, categoryId: string): Finding[];
export declare function hasCriticalFindings(review: StructuredReview): boolean;
export declare function sortFindingsForReview(findings: Finding[]): Finding[];
/**
 * Parse output from the judge dedup agent — a bare JSON array of findings.
 */
export declare function parseDedupedFindings(raw: string): Finding[];
export declare function extractJson(text: string): string;
export declare function formatFindingsMarkdown(structured: StructuredReview, categoryLabels: Record<string, string>): string;
