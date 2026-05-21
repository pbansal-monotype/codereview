/**
 * Redact sensitive values before sending diffs to an LLM.
 * Patterns are conservative — false positives are preferable to leaks.
 */
export declare function redactSecrets(text: string): string;
export declare function countRedactions(original: string, redacted: string): number;
