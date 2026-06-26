import type { Confidence, Finding, Severity } from '../output/findings';
import { findingFingerprint } from '../output/findings';

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

export function toStoredFinding(f: Finding): StoredFinding {
  return {
    fingerprint: findingFingerprint(f),
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    file: f.file ?? '',
    line: f.line,
    codeSnippet: f.codeSnippet,
    message: f.message,
  };
}

export function fromStoredFinding(s: StoredFinding): Finding {
  return {
    category: s.category,
    severity: s.severity,
    confidence: s.confidence,
    file: s.file,
    line: s.line,
    codeSnippet: s.codeSnippet,
    message: s.message,
  };
}

export function toStoredFindings(findings: Finding[]): StoredFinding[] {
  return findings.map(toStoredFinding);
}

export function fromStoredFindings(stored: StoredFinding[]): Finding[] {
  return stored.map(fromStoredFinding);
}
