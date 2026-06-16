export type Severity = 'critical' | 'warning' | 'suggestion';
export type Confidence = 'high' | 'medium' | 'low';
export interface Finding {
    category: string;
    severity: Severity;
    confidence: Confidence;
    file?: string;
    line?: number;
    message: string;
}
export interface StructuredReview {
    summary: string;
    findings: Finding[];
}
export declare function parseStructuredReview(raw: string): StructuredReview;
/**
 * Parse output from a specialist agent where category is known externally.
 * Simpler schema: { findings: [{ severity, confidence, file, line, message }] }
 */
export declare function parseSpecialistFindings(raw: string, categoryId: string): Finding[];
export declare function hasCriticalFindings(review: StructuredReview): boolean;
export declare function extractJson(text: string): string;
export declare function formatFindingsMarkdown(structured: StructuredReview, categoryLabels: Record<string, string>): string;
