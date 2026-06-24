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

export function parseStructuredReview(
  raw: string,
  options: ParseStructuredReviewOptions = {},
): StructuredReview {
  const {
    capFindings: _capFindings = true,
    filterVague = true,
    filterLowConfidence = true,
  } = options;

  const parsed = parseJsonPayload(raw) as Partial<StructuredReview>;

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

      if (filterLowConfidence && confidence === 'low') continue;

      if (filterVague && isVagueFinding(f.message)) continue;

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

  const sorted = sortFindingsForReview(findings);

  return {
    summary,
    findings: sorted,
  };
}

function buildFindingSummary(findings: Finding[]): string {
  if (findings.length === 0) return 'No issues found.';

  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) counts[f.severity]++;

  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.warning) parts.push(`${counts.warning} warning`);
  if (counts.suggestion) parts.push(`${counts.suggestion} suggestion`);

  return `Review found ${findings.length} issue(s): ${parts.join(', ')}.`;
}

/** Build the final review from deduplicated judge output. */
export function buildJudgeReviewFromDedup(findings: Finding[]): StructuredReview {
  const sorted = sortFindingsForReview(findings);
  return {
    summary: buildFindingSummary(sorted),
    findings: sorted,
  };
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

export function sortFindingsForReview(findings: Finding[]): Finding[] {
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 };
  return [...findings].sort((a, b) => {
    const sDiff = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    if (sDiff !== 0) return sDiff;
    return (a.file ?? '').localeCompare(b.file ?? '');
  });
}

/**
 * Parse output from the judge dedup agent.
 * Accepts { "findings": [...] } (required by OpenAI/Azure json_object mode) or a bare array.
 */
export function parseDedupedFindings(raw: string): Finding[] {
  const parsed = parseJsonPayload(raw);
  const items = coerceFindingsArray(parsed);

  const findings: Finding[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Partial<Finding>;
    const severity = String(f.severity ?? '').toLowerCase();
    if (!VALID_SEVERITIES.has(severity)) continue;
    if (!f.message || typeof f.message !== 'string') continue;
    if (!f.category || typeof f.category !== 'string') continue;
    if (!f.file || typeof f.file !== 'string') continue;

    const confidence = VALID_CONFIDENCES.has(String(f.confidence ?? '').toLowerCase())
      ? (String(f.confidence).toLowerCase() as Confidence)
      : 'medium';

    findings.push({
      category: f.category,
      severity: severity as Severity,
      confidence,
      file: f.file,
      line: typeof f.line === 'number' ? f.line : undefined,
      codeSnippet: typeof f.codeSnippet === 'string' ? f.codeSnippet.trim() : undefined,
      message: f.message,
    });
  }

  return findings;
}

function coerceFindingsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { findings?: unknown }).findings)
  ) {
    return (parsed as { findings: unknown[] }).findings;
  }
  throw new Error('Dedup agent output must be a JSON array or { "findings": [...] } object');
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
};

/** Merge findings by category + file + line, keeping the highest-severity entry. */
export function mechanicalDedup(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.category}\0${f.file ?? ''}\0${String(f.line ?? '')}`;
    const existing = seen.get(key);
    if (
      !existing ||
      SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.severity]
    ) {
      seen.set(key, f);
    }
  }
  return sortFindingsForReview([...seen.values()]);
}

/** Build a degraded review when the judge fails to parse after retry. */
export function buildUnverifiedFallback(
  findings: Finding[],
  reason: string,
): StructuredReview {
  const deduped = mechanicalDedup(findings);

  return {
    summary:
      `Review completed with degraded judge output (dedup failed: ${reason}). ` +
      `Findings below are from specialist agents and may include duplicates.`,
    findings: deduped,
    unverified: true,
  };
}

function extractCompleteJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '{') {
      i++;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    const start = i;

    for (; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(start, i + 1));
          i++;
          break;
        }
      }
    }

    if (depth !== 0) break;
  }

  return objects;
}

/**
 * Salvage complete finding objects from truncated judge JSON
 * (e.g. output cut off mid-array or mid-object).
 */
export function salvageTruncatedFindingsJson(raw: string): string | null {
  const trimmed = raw.trim();
  const findingsKeyMatch = trimmed.match(/"findings"\s*:\s*\[/);

  let arraySlice: string;
  let wrapInObject: boolean;

  if (findingsKeyMatch && findingsKeyMatch.index !== undefined) {
    const arrayStart = trimmed.indexOf('[', findingsKeyMatch.index);
    if (arrayStart === -1) return null;
    arraySlice = trimmed.slice(arrayStart);
    wrapInObject = true;
  } else {
    const arrayStart = trimmed.indexOf('[');
    if (arrayStart === -1) return null;
    arraySlice = trimmed.slice(arrayStart);
    wrapInObject = false;
  }

  const objects = extractCompleteJsonObjects(arraySlice);
  if (objects.length === 0) return null;

  const arrayJson = `[${objects.join(',')}]`;
  try {
    JSON.parse(arrayJson);
  } catch {
    return null;
  }

  return wrapInObject ? `{"findings":${arrayJson}}` : arrayJson;
}

function parseJsonPayload(raw: string): unknown {
  const candidates: string[] = [];
  const extracted = extractJson(raw);
  candidates.push(extracted);

  for (const salvageSource of [raw, extracted]) {
    const salvaged = salvageTruncatedFindingsJson(salvageSource);
    if (salvaged) candidates.push(salvaged);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new SyntaxError('No parseable JSON found');
}

export function extractJson(text: string): string {
  const trimmed = text.trim();

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fencedBlocks.length > 0) {
    const last = fencedBlocks[fencedBlocks.length - 1];
    return last[1].trim();
  }

  const arrayStart = trimmed.indexOf('[');
  const objectStart = trimmed.indexOf('{');

  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayEnd > arrayStart) {
      const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        for (let i = arrayEnd; i > arrayStart; i--) {
          if (trimmed[i] !== ']') continue;
          const slice = trimmed.slice(arrayStart, i + 1);
          try {
            JSON.parse(slice);
            return slice;
          } catch {
            continue;
          }
        }
      }
    }
  }

  const start = objectStart;
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
