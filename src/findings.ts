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

const VALID_SEVERITIES = new Set<string>(['critical', 'warning', 'suggestion']);
const VALID_CONFIDENCES = new Set<string>(['high', 'medium', 'low']);

const MAX_FINDINGS = 8;

const VAGUE_PATTERNS = [
  /^ensure\b/i,
  /^make sure\b/i,
  /^consider\b/i,
  /^verify that\b/i,
  /^check that\b/i,
  /^be careful\b/i,
  /\bshould be\b.*\bproperly\b/i,
  /\bpotentially\b.*\bvulnerable\b/i,
  /\bcould potentially\b/i,
  /\bmay lead to\b.*\bissues\b/i,
  /\bmight cause\b.*\bproblems\b/i,
];

function stripBrackets(text: string): string {
  return text.replace(/^\[|\]$/g, '').trim();
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isVagueFinding(message: string): boolean {
  const parts = message.split('→').map((p) => stripBrackets(p.trim()));
  return parts.some((part) =>
    VAGUE_PATTERNS.some((pattern) => pattern.test(part)),
  );
}

export function parseStructuredReview(raw: string): StructuredReview {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as Partial<StructuredReview>;

  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const findings: Finding[] = [];

  if (Array.isArray(parsed.findings)) {
    for (const item of parsed.findings) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Partial<Finding>;
      const severity = String(f.severity ?? '').toLowerCase();
      if (!VALID_SEVERITIES.has(severity)) continue;
      if (!f.message || typeof f.message !== 'string') continue;
      if (!f.category || typeof f.category !== 'string') continue;

      const confidence = VALID_CONFIDENCES.has(String(f.confidence ?? '').toLowerCase())
        ? (String(f.confidence).toLowerCase() as Confidence)
        : 'medium';

      if (confidence === 'low') continue;

      if (isVagueFinding(f.message)) continue;

      if (!f.file || typeof f.file !== 'string') continue;

      findings.push({
        category: f.category,
        severity: severity as Severity,
        confidence,
        file: f.file,
        line: typeof f.line === 'number' ? f.line : undefined,
        codeSnippet: typeof f.codeSnippet === 'string' ? f.codeSnippet.trim() : undefined,
        message: normalizeMessage(f.message),
      });
    }
  }

  const sorted = findings.sort((a, b) => {
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 };
    const confOrder: Record<string, number> = { high: 0, medium: 1 };
    const sDiff = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    if (sDiff !== 0) return sDiff;
    return (confOrder[a.confidence] ?? 1) - (confOrder[b.confidence] ?? 1);
  });

  return { summary, findings: sorted.slice(0, MAX_FINDINGS) };
}

/**
 * Parse output from a specialist agent where category is known externally.
 * Simpler schema: { findings: [{ severity, confidence, file, line, message }] }
 */
export function parseSpecialistFindings(raw: string, categoryId: string): Finding[] {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as { findings?: unknown[] };
  const findings: Finding[] = [];

  if (!Array.isArray(parsed.findings)) return findings;

  for (const item of parsed.findings) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const severity = String(f.severity ?? '').toLowerCase();
    if (!VALID_SEVERITIES.has(severity)) continue;
    if (!f.message || typeof f.message !== 'string') continue;

    const confidence = VALID_CONFIDENCES.has(String(f.confidence ?? '').toLowerCase())
      ? (String(f.confidence).toLowerCase() as Confidence)
      : 'medium';

    if (confidence === 'low') continue;
    if (isVagueFinding(f.message as string)) continue;
    if (!f.file || typeof f.file !== 'string') continue;

    findings.push({
      category: categoryId,
      severity: severity as Severity,
      confidence,
      file: f.file,
      line: typeof f.line === 'number' ? f.line : undefined,
      codeSnippet: typeof f.codeSnippet === 'string' ? (f.codeSnippet as string).trim() : undefined,
      message: normalizeMessage(f.message as string),
    });
  }

  return findings;
}

export function hasCriticalFindings(review: StructuredReview): boolean {
  return review.findings.some((f) => f.severity === 'critical');
}

export function extractJson(text: string): string {
  const trimmed = text.trim();

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fencedBlocks.length > 0) {
    const last = fencedBlocks[fencedBlocks.length - 1];
    return last[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // First-to-last braces didn't produce valid JSON; try finding the
      // largest balanced top-level object
      for (let i = end; i > start; i--) {
        if (trimmed[i] !== '}') continue;
        const slice = trimmed.slice(start, i + 1);
        try {
          JSON.parse(slice);
          return slice;
        } catch {
          continue;
        }
      }
      return candidate;
    }
  }

  return trimmed;
}

export function formatFindingsMarkdown(
  structured: StructuredReview,
  categoryLabels: Record<string, string>,
): string {
  const byCategory = new Map<string, Finding[]>();
  for (const f of structured.findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  let md = '';
  if (structured.summary) {
    md += `${structured.summary}\n\n`;
  }

  if (structured.findings.length === 0) {
    md += 'No issues found.\n';
    return md;
  }

  for (const [category, findings] of byCategory) {
    const label = categoryLabels[category] ?? category;
    md += `### ${label}\n\n`;
    for (const f of findings) {
      const icon = severityIcon(f.severity);
      const loc = f.line
        ? ` \`${f.file}:${f.line}\``
        : ` \`${f.file}\``;
      md += `- ${icon} **${f.severity.toUpperCase()}**${loc} — ${f.message}\n`;
      if (f.codeSnippet) {
        md += `\n  \`\`\`\n  ${f.codeSnippet.replace(/\n/g, '\n  ')}\n  \`\`\`\n`;
      }
    }
    md += '\n';
  }

  return md;
}

function severityIcon(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'suggestion':
      return '🔵';
  }
}
