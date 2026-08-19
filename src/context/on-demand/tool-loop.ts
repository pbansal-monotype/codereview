import * as core from '@actions/core';
import { AIProvider } from '../../providers';
import {
  Finding,
  parseSpecialistFindings,
  sanitizeSpecialistFindings,
} from '../../output/findings';
import { TOOL_INSTRUCTIONS, TOOL_CATEGORIES, MAX_TOOL_HOPS } from '../../config/tools';
import {
  ToolContext,
  readFile,
  searchText,
  findReferences,
  type ReferenceLocation,
} from './tools';
import { TokenUsage } from '../../agents/types';
import type { ToolCallRecord, ToolLoopDebugRecorder } from '../../output/debug';

export function specialistUsesToolLoop(categoryId: string): boolean {
  return TOOL_CATEGORIES.has(categoryId);
}

/**
 * Hard cap on caller subagents dispatched per `find_references` hit. Without
 * this, a symbol with many callers fans out to one LLM call each with no bound.
 * Candidates are ranked by reference quality (semantic > syntactic > text-match)
 * so the cap keeps the highest-signal callers.
 */
const MAX_CALLER_SUBAGENTS = 5;

const REFERENCE_SOURCE_RANK: Record<ReferenceLocation['source'], number> = {
  semantic: 0,
  syntactic: 1,
  'text-match': 2,
};

function rankCallersByQuality(candidates: ReferenceLocation[]): ReferenceLocation[] {
  return [...candidates].sort(
    (a, b) => REFERENCE_SOURCE_RANK[a.source] - REFERENCE_SOURCE_RANK[b.source],
  );
}

interface ToolRequest {
  action: 'tool';
  tool: string;
  arguments: Record<string, unknown>;
}

interface DoneResponse {
  action: 'done';
  findings?: Finding[];
}

interface CallerVerdict {
  caller: ReferenceLocation;
  breaks: 'yes' | 'no' | 'uncertain';
  why: string;
}

export interface ToolLoopResult {
  findings: Finding[];
  tokens: TokenUsage;
  apiCalls: number;
}

export async function runSpecialistToolLoop(
  provider: AIProvider,
  categoryId: string,
  systemPrompt: string,
  userPrompt: string,
  toolCtx: ToolContext,
  timeoutMs: number,
  debugRecorder?: ToolLoopDebugRecorder,
): Promise<ToolLoopResult> {
  const deadline = Date.now() + timeoutMs;
  let totalInput = 0;
  let totalOutput = 0;
  let apiCalls = 0;

  let conversation = userPrompt;
  const toolResults: string[] = [];
  let callerVerdicts: CallerVerdict[] = [];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      core.warning(`[${categoryId}] Tool loop hit wall-clock timeout`);
      break;
    }

    const hopPrompt =
      conversation +
      (toolResults.length > 0
        ? `\n\n## Tool results (hop ${hop})\n${toolResults.join('\n\n')}`
        : '') +
      (callerVerdicts.length > 0
        ? `\n\n## Caller assessments\n${formatCallerVerdicts(callerVerdicts)}`
        : '');

    const loopSystemPrompt = systemPrompt + TOOL_INSTRUCTIONS;
    const response = await provider.review({
      systemPrompt: loopSystemPrompt,
      // The system prompt is identical across every hop, so cache it once and
      // let subsequent hops (and other specialists sharing the prefix) hit the
      // provider prompt cache instead of re-billing the full prefix each time.
      systemPromptBlocks: [{ text: loopSystemPrompt, ephemeralCache: true }],
      userPrompt: hopPrompt,
      timeoutMs: remainingMs,
    });
    apiCalls++;
    totalInput += response.inputTokens;
    totalOutput += response.outputTokens;

    const parsed = parseToolResponse(response.review);
    if (!parsed) {
      // Try parsing as direct findings JSON (backward compat)
      try {
        const findings = parseSpecialistFindings(response.review, categoryId);
        return { findings, tokens: { input: totalInput, output: totalOutput }, apiCalls };
      } catch {
        core.warning(`[${categoryId}] Unparseable tool-loop response on hop ${hop + 1}`);
        break;
      }
    }

    if (parsed.action === 'done') {
      const findings = sanitizeSpecialistFindings(parsed.findings, categoryId);
      const dropped = (parsed.findings?.length ?? 0) - findings.length;
      if (dropped > 0) {
        core.info(`[${categoryId}] Dropped ${dropped} vague/low-confidence/malformed finding(s)`);
      }
      return { findings, tokens: { input: totalInput, output: totalOutput }, apiCalls };
    }

    toolResults.length = 0;
    callerVerdicts = [];

    const toolResult = executeTool(toolCtx, parsed);
    toolResults.push(toolResult.text);

    let callerVerdictsForDebug: ToolCallRecord['callerVerdicts'];

    if (toolResult.referenceCandidates && toolResult.referenceCandidates.length > 1) {
      const verdicts = await dispatchCallerSubagents(
        provider,
        categoryId,
        toolResult.referenceCandidates,
        parsed,
        toolCtx,
        deadline,
      );
      apiCalls += verdicts.apiCalls;
      totalInput += verdicts.tokens.input;
      totalOutput += verdicts.tokens.output;
      callerVerdicts = verdicts.verdicts;
      callerVerdictsForDebug = verdicts.verdicts.map((v) => ({
        file: v.caller.file,
        line: v.caller.line,
        breaks: v.breaks,
        why: v.why,
      }));
    }

    debugRecorder?.record({
      categoryId,
      hop,
      tool: parsed.tool,
      arguments: parsed.arguments ?? {},
      resultSummary: toolResult.summary,
      callerVerdicts: callerVerdictsForDebug,
    });
  }

  core.warning(`[${categoryId}] Tool loop exhausted ${MAX_TOOL_HOPS} hops without final findings`);
  return { findings: [], tokens: { input: totalInput, output: totalOutput }, apiCalls };
}

function parseToolResponse(text: string): ToolRequest | DoneResponse | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const raw = jsonMatch ? jsonMatch[1] : text;
  try {
    const obj = JSON.parse(raw.trim());
    if (obj.action === 'tool' || obj.action === 'done') return obj;
    if (Array.isArray(obj.findings)) return { action: 'done', findings: obj.findings };
    return null;
  } catch {
    return null;
  }
}

interface ToolExecutionResult {
  text: string;
  summary: string;
  referenceCandidates?: ReferenceLocation[];
}

function executeTool(ctx: ToolContext, req: ToolRequest): ToolExecutionResult {
  const args = req.arguments ?? {};

  switch (req.tool) {
    case 'read_file': {
      const path = String(args.path ?? '');
      const content = readFile(ctx, path);
      if (content === null) {
        return {
          text: `read_file("${path}"): not found or not allowed`,
          summary: 'not found or not allowed',
        };
      }
      return {
        text: `read_file("${path}"):\n<file path="${path}">\n${content}\n</file>`,
        summary: `${content.length.toLocaleString()} chars`,
      };
    }
    case 'search_text': {
      const pattern = String(args.pattern ?? '');
      const glob = args.path_pattern ? String(args.path_pattern) : undefined;
      const results = searchText(ctx, pattern, glob);
      return {
        text: `search_text("${pattern}"${glob ? `, "${glob}"` : ''}): ${results.length} match(es)\n${formatRefResults(results)}`,
        summary: `${results.length} match(es)`,
      };
    }
    case 'find_references': {
      const symbol = String(args.symbol ?? '');
      const filePath = String(args.file_path ?? '');
      const results = findReferences(ctx, symbol, filePath);
      return {
        text: `find_references("${symbol}", "${filePath}"): ${results.length} reference(s)\n${formatRefResults(results)}`,
        summary: `${results.length} reference(s)`,
        referenceCandidates: results.length > 1 ? results : undefined,
      };
    }
    default:
      return { text: `Unknown tool: ${req.tool}`, summary: 'unknown tool' };
  }
}

function formatRefResults(results: ReferenceLocation[]): string {
  if (results.length === 0) return '  (none)';
  return results
    .map((r) => `  - ${r.file}:${r.line} [${r.source}] ${r.snippet}`)
    .join('\n');
}

function formatCallerVerdicts(verdicts: CallerVerdict[]): string {
  return verdicts
    .map(
      (v) =>
        `- ${v.caller.file}:${v.caller.line} → breaks=${v.breaks}: ${v.why}`,
    )
    .join('\n');
}

async function dispatchCallerSubagents(
  provider: AIProvider,
  categoryId: string,
  candidates: ReferenceLocation[],
  toolReq: ToolRequest,
  toolCtx: ToolContext,
  deadline: number,
): Promise<{ verdicts: CallerVerdict[]; tokens: TokenUsage; apiCalls: number }> {
  const symbol = String(toolReq.arguments?.symbol ?? 'unknown');
  const targetPath = String(toolReq.arguments?.file_path ?? 'unknown');

  const ranked = rankCallersByQuality(candidates);
  const assessed = ranked.slice(0, MAX_CALLER_SUBAGENTS);
  const omitted = ranked.slice(MAX_CALLER_SUBAGENTS);

  if (omitted.length > 0) {
    core.info(
      `[${categoryId}] Caller cap reached: assessing ${assessed.length}/${candidates.length} ` +
      `caller(s) of "${symbol}", ${omitted.length} omitted`,
    );
  }

  const tasks = assessed.map(async (caller): Promise<CallerVerdict & { tokens: TokenUsage }> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        caller,
        breaks: 'uncertain' as const,
        why: 'Timeout before subagent could assess',
        tokens: { input: 0, output: 0 },
      };
    }

    const callerContent = readFile(toolCtx, caller.file) ?? caller.snippet;
    const systemPrompt = `You are a focused code-review subagent assessing ONE caller site in isolation.
Return JSON only: { "breaks": "yes" | "no" | "uncertain", "why": "one-line reason" }
"breaks" = yes if this caller would break or misbehave due to the changed symbol/API.`;

    const userPrompt = `Category: ${categoryId}
Changed symbol: ${symbol} in ${targetPath}
Caller site: ${caller.file}:${caller.line} [${caller.source}]

<caller-context path="${caller.file}">
${callerContent}
</caller-context>

Does this specific caller break due to the change?`;

    try {
      const response = await provider.review({
        systemPrompt,
        systemPromptBlocks: [{ text: systemPrompt, ephemeralCache: true }],
        userPrompt,
        timeoutMs: remainingMs,
      });
      const verdict = parseCallerVerdict(response.review);
      return {
        caller,
        breaks: verdict.breaks,
        why: verdict.why,
        tokens: { input: response.inputTokens, output: response.outputTokens },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        caller,
        breaks: 'uncertain',
        why: `Subagent failed: ${msg}`,
        tokens: { input: 0, output: 0 },
      };
    }
  });

  const results = await Promise.all(tasks);
  let input = 0;
  let output = 0;
  const verdicts: CallerVerdict[] = [];
  for (const r of results) {
    input += r.tokens.input;
    output += r.tokens.output;
    verdicts.push({ caller: r.caller, breaks: r.breaks, why: r.why });
  }

  for (const caller of omitted) {
    verdicts.push({
      caller,
      breaks: 'uncertain',
      why: `Not assessed (caller cap of ${MAX_CALLER_SUBAGENTS} reached)`,
    });
  }

  return {
    verdicts,
    tokens: { input, output },
    apiCalls: assessed.length,
  };
}

function parseCallerVerdict(text: string): { breaks: 'yes' | 'no' | 'uncertain'; why: string } {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  try {
    const obj = JSON.parse((jsonMatch?.[1] ?? text).trim());
    const breaks = obj.breaks;
    if (breaks === 'yes' || breaks === 'no' || breaks === 'uncertain') {
      return { breaks, why: String(obj.why ?? '') };
    }
  } catch {
    // fall through
  }
  return { breaks: 'uncertain', why: 'Could not parse subagent verdict' };
}
