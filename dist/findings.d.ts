export type Severity = 'critical' | 'warning' | 'suggestion';
export interface Finding {
    category: string;
    severity: Severity;
    file?: string;
    line?: number;
    message: string;
}
export interface StructuredReview {
    summary: string;
    findings: Finding[];
}
export declare function parseStructuredReview(raw: string): StructuredReview;
export declare function hasCriticalFindings(review: StructuredReview): boolean;
export declare function extractJson(text: string): string;
export declare function formatFindingsMarkdown(structured: StructuredReview, categoryLabels: Record<string, string>): string;
