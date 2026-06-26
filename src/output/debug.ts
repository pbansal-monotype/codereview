import { Finding } from './findings';
import { SpecialistResult } from '../agents/types';
import { FileRankingEntry, ReviewContextStats } from '../context/diff/types';
import { CATEGORY_LABELS } from '../config/prompts';

export interface ToolCallRecord {
  categoryId: string;
  hop: number;
  tool: string;
  arguments: Record<string, unknown>;
  resultSummary: string;
  callerVerdicts?: { file: string; line: number; breaks: string; why: string }[];
}

export interface ReviewDebugStats {
  contextStats: ReviewContextStats;
  fileRanking: FileRankingEntry[];
  toolCalls: ToolCallRecord[];
  diffFilteredOut: Finding[];
  judgeUnverified: boolean;
  judgeRawFindings: number;
  judgeFinalFindings: number;
}

export class ToolLoopDebugRecorder {
  readonly calls: ToolCallRecord[] = [];

  record(entry: ToolCallRecord): void {
    this.calls.push(entry);
  }
}

export function formatDebugStatsMarkdown(
  stats: ReviewDebugStats,
  specialistResults: SpecialistResult[],
): string {
  let md = '';

  md += `\n#### Context budget\n`;
  md += `- Total diff files: ${stats.contextStats.totalFiles}\n`;
  md += `- Included: ${stats.contextStats.includedCount} · Skipped: ${stats.contextStats.skippedCount}\n`;
  md += `- Chars used: ${stats.contextStats.usedChars.toLocaleString()} / ${stats.contextStats.budgetChars.toLocaleString()} (${stats.contextStats.utilizationPct}%)\n`;

  md += `\n#### File ranking (risk-sorted)\n\n`;
  md += `| Rank | File | Base | Effective | Disposition | Mode | Callers |\n`;
  md += `|------|------|------|-----------|-------------|------|--------|\n`;
  for (const f of stats.fileRanking) {
    const mode = f.mode ?? '—';
    const callers =
      f.callerRefs.length > 0
        ? f.callerRefs.map((c) => `${c.file}:${c.line}`).join(', ')
        : '—';
    const skip = f.skipReason ? ` (${f.skipReason})` : '';
    md += `| ${f.rank} | \`${f.filePath}\` | ${f.baseScore.toFixed(2)} | ${f.effectiveScore.toFixed(2)} | ${f.disposition}${skip} | ${mode} | ${callers} |\n`;
  }

  if (stats.toolCalls.length > 0) {
    md += `\n#### On-demand tool calls\n\n`;
    for (const call of stats.toolCalls) {
      const label = CATEGORY_LABELS[call.categoryId] || call.categoryId;
      const args = JSON.stringify(call.arguments);
      md += `- **${label}** hop ${call.hop + 1}: \`${call.tool}\` ${args}\n`;
      md += `  - ${call.resultSummary}\n`;
      if (call.callerVerdicts && call.callerVerdicts.length > 0) {
        for (const v of call.callerVerdicts) {
          md += `  - caller \`${v.file}:${v.line}\` → **${v.breaks}**: ${v.why}\n`;
        }
      }
    }
  } else {
    md += `\n#### On-demand tool calls\n\n(none)\n`;
  }

  md += `\n#### Specialist API calls\n\n`;
  for (const r of specialistResults) {
    const label = CATEGORY_LABELS[r.categoryId] || r.categoryId;
    md += `- **${label}**: ${r.apiCalls} API call(s), ${r.findings.length} raw finding(s), `;
    md += `${(r.tokens.input + r.tokens.output).toLocaleString()} tokens`;
    if (r.failed) md += ` — ❌ ${r.error}`;
    md += `\n`;
  }

  md += `\n#### Judge\n`;
  md += `- Raw specialist findings: ${stats.judgeRawFindings}\n`;
  md += `- After dedup: ${stats.judgeFinalFindings}\n`;
  if (stats.judgeUnverified) {
    md += `- ⚠️ Judge parse failed — unverified fallback used\n`;
  }

  if (stats.diffFilteredOut.length > 0) {
    md += `\n#### Findings dropped (not on changed diff lines)\n\n`;
    for (const f of stats.diffFilteredOut) {
      md += `- \`${f.file}:${f.line ?? '?'}\` [${f.severity}] ${f.message.slice(0, 120)}\n`;
    }
  }

  return md;
}
