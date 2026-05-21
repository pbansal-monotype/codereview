/**
 * Redact sensitive values before sending diffs to an LLM.
 * Patterns are conservative — false positives are preferable to leaks.
 */

const REDACTION = '[REDACTED]';

const PATTERNS: RegExp[] = [
  // AWS keys
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  // GitHub tokens
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  // Generic API keys in assignments
  /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"]?[A-Za-z0-9_\-./+=]{8,}['"]?/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // JWTs (three base64 segments)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // PEM private keys
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  // Connection strings with credentials
  /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/gi,
  // Slack / Stripe style keys
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /sk_(?:live|test)_[A-Za-z0-9]+/g,
  // Anthropic / OpenAI style keys in diffs
  /sk-ant-[A-Za-z0-9\-_]+/g,
  /sk-proj-[A-Za-z0-9\-_]+/g,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, REDACTION);
  }
  return result;
}

export function countRedactions(original: string, redacted: string): number {
  const matches = redacted.match(/\[REDACTED\]/g);
  return matches?.length ?? 0;
}
