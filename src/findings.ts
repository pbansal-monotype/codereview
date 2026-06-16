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

const VALID_SEVERITIES = new Set<string>(['critical', 'warning', 'suggestion']);

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

      findings.push({
        category: f.category,
        severity: severity as Severity,
        file: typeof f.file === 'string' ? f.file : undefined,
        line: typeof f.line === 'number' ? f.line : undefined,
        message: f.message,
      });
    }
  }

  return { summary, findings };
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
      const loc = f.file
        ? f.line
          ? ` \`${f.file}:${f.line}\``
          : ` \`${f.file}\``
        : '';
      md += `- ${icon} **${f.severity.toUpperCase()}**${loc}: ${f.message}\n`;
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
