import type { Confidence, Finding, Severity } from '../output/findings';
export interface StoredFinding {
    fingerprint: string;
    category: string;
    severity: Severity;
    confidence: Confidence;
    file: string;
    line?: number;
    codeSnippet?: string;
    message: string;
}
export declare function toStoredFinding(f: Finding): StoredFinding;
export declare function fromStoredFinding(s: StoredFinding): Finding;
export declare function toStoredFindings(findings: Finding[]): StoredFinding[];
export declare function fromStoredFindings(stored: StoredFinding[]): Finding[];
//# sourceMappingURL=findings-state.d.ts.map