/**
 * run-agent-local.ts
 *
 * Run guideline specialists or the judge agent locally against a diff file.
 * Accepts raw unified diffs or GitHub Actions debug logs (e.g. Debug/securitylogs.txt).
 *
 * Usage:
 *   npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent security
 *   npx ts-node src/eval/run-agent-local.ts --agent judge --findings Debug/judge.txt
 *   npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent judge --findings specialists.json
 *
 * Options:
 *   --agent <id>        security | tests | performance | code | judge | all  (default: security)
 *   --metadata <file>   JSON with PR title/body/author/branches and optional fileContents
 *   --files-dir <dir>   Directory tree whose paths mirror repo files (loads full file context)
 *   --findings <file>   Specialist JSON or GitHub Actions judge debug log
 *   --output <file>     Write JSON result to file instead of stdout
 *   --provider <name>   anthropic | openai | azure  (default: azure)
 *   --model <name>      Override default model for the provider
 *   --verbose           Print raw LLM responses to stderr
 *
 * Findings file format (for --agent judge):
 *   {
 *     "enabledCategories": ["security", "code"],
 *     "specialistResults": [
 *       {
 *         "categoryId": "security",
 *         "findings": [{ "category": "security", "severity": "critical", ... }],
 *         "tokens": { "input": 0, "output": 0 },
 *         "failed": false
 *       }
 *     ]
 *   }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_GUIDELINES } from '../agents/guidelines';
import { runJudge } from '../agents/judge';
import { runSpecialistAgent } from '../agents/specialist';
import type { SpecialistResult } from '../agents/types';
import type { ReviewConfig } from '../config';
import { splitDiffByFile } from '../context/diff';
import type { FileContent, PullRequestData } from '../github';
import { createProvider } from '../providers';
import { buildSharedContext } from '../agents/prompts';
import { parseSpecialistFindings } from '../findings';

const SPECIALIST_IDS = ['security', 'tests', 'performance', 'code'] as const;
type SpecialistId = (typeof SPECIALIST_IDS)[number];
type AgentId = SpecialistId | 'judge' | 'all';

// ─── Local Azure defaults (edit for local testing; env vars override) ─
const HARDCODED_AZURE_API_KEY = '';
const HARDCODED_AZURE_ENDPOINT = '';
const HARDCODED_AZURE_MODEL = 'gpt-5.4-nano';

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  azure: HARDCODED_AZURE_MODEL,
};

interface LocalMetadata {
  number?: number;
  title?: string;
  body?: string;
  author?: string;
  headBranch?: string;
  baseBranch?: string;
  customPrompt?: string;
  fileContents?: FileContent[];
}

interface NormalizedDiffInput {
  diff: string;
  metadata: LocalMetadata;
}

interface CliOptions {
  diffFile?: string;
  agent: AgentId;
  metadataFile?: string;
  filesDir?: string;
  findingsFile?: string;
  outputFile?: string;
  provider: 'anthropic' | 'openai' | 'azure';
  model?: string;
  verbose: boolean;
}

interface FindingsInput {
  enabledCategories?: string[];
  specialistResults: SpecialistResult[];
}

// ─── CLI parsing ────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`Usage: npx ts-node src/eval/run-agent-local.ts [<diff-file>] [options]

Agents:
  security, tests, performance, code   Run one guideline specialist
  judge                                Run judge (--findings required; diff optional if log has code context)
  all                                  Run all specialists, then judge

Options:
  --agent <id>        Agent to run (default: security)
  --metadata <file>   Optional PR metadata JSON
  --files-dir <dir>   Repo snapshot for full-file context
  --findings <file>   Specialist JSON or GitHub Actions judge debug log (Debug/judge.txt)
  --output <file>     Write JSON result to file
  --provider <name>   anthropic | openai | azure
  --model <name>      Override provider default model
  --verbose           Log raw LLM responses to stderr
  --help              Show this help

Judge examples:
  npx ts-node src/eval/run-agent-local.ts --agent judge --findings Debug/judge.txt
  npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent judge --findings specialists.json
`);
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags.set(key, true);
      } else {
        flags.set(key, next);
        i++;
      }
      continue;
    }
    positional.push(arg);
  }

  if (positional.length === 0 && String(flags.get('agent') ?? 'security').toLowerCase() !== 'judge') {
    printHelp();
    process.exit(1);
  }

  const agentRaw = String(flags.get('agent') ?? 'security').toLowerCase();
  if (!['security', 'tests', 'performance', 'code', 'judge', 'all'].includes(agentRaw)) {
    console.error(`Unknown agent "${agentRaw}". Use one of: security, tests, performance, code, judge, all`);
    process.exit(1);
  }

  if (positional.length === 0 && !flags.has('findings')) {
    console.error('Judge mode requires --findings <file> when no diff file is provided');
    process.exit(1);
  }

  const providerRaw = String(flags.get('provider') ?? 'azure').toLowerCase();
  if (!['anthropic', 'openai', 'azure'].includes(providerRaw)) {
    console.error(`Unknown provider "${providerRaw}". Use anthropic, openai, or azure.`);
    process.exit(1);
  }

  return {
    diffFile: positional[0] ? path.resolve(positional[0]) : undefined,
    agent: agentRaw as AgentId,
    metadataFile: flags.has('metadata') ? path.resolve(String(flags.get('metadata'))) : undefined,
    filesDir: flags.has('files-dir') ? path.resolve(String(flags.get('files-dir'))) : undefined,
    findingsFile: flags.has('findings') ? path.resolve(String(flags.get('findings'))) : undefined,
    outputFile: flags.has('output') ? path.resolve(String(flags.get('output'))) : undefined,
    provider: providerRaw as CliOptions['provider'],
    model: flags.has('model') ? String(flags.get('model')) : undefined,
    verbose: flags.has('verbose'),
  };
}

// ─── Data loading ───────────────────────────────────────────────────

/** Strip GitHub Actions log prefixes from a single line. */
function stripLogLinePrefix(line: string): string {
  return line
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, '')
    .replace(/^##\[debug\]\s?/, '');
}

/** True for markup lines that wrap per-file diff hunks in debug logs. */
function isDiffWrapperLine(trimmed: string): boolean {
  if (trimmed === '<diff>' || trimmed === '</diff>') return true;
  if (/^<diff\s+path="[^"]*"\s*>$/.test(trimmed)) return true;
  if (/^<!--\s*file:/.test(trimmed)) return true;
  if (trimmed === '```' || trimmed === '```diff') return true;
  if (/^\.\.\. \[\d+ file\(s\) truncated:/.test(trimmed)) return true;
  return false;
}

/** Collect per-file <diff path="...">…</diff> blocks from a log dump. */
function extractPerFileDiffBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const re = /<diff(?:\s+path="[^"]*")?\s*>([\s\S]*?)<\/diff>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match[1].includes('diff --git')) {
      blocks.push(match[1]);
    }
  }
  return blocks;
}

/** Clean log lines into diff content. */
function cleanDiffLines(text: string): string {
  const cleaned: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripLogLinePrefix(rawLine);
    const trimmed = line.trim();

    if (!trimmed) {
      cleaned.push('');
      continue;
    }
    if (isDiffWrapperLine(trimmed)) continue;

    cleaned.push(line);
  }

  let diff = cleaned.join('\n').trim();
  const firstHunk = diff.search(/^diff --git /m);
  if (firstHunk > 0) {
    diff = diff.slice(firstHunk);
  }
  return diff;
}

/** Extract PR metadata embedded in GitHub Actions debug logs. */
function extractLogMetadata(raw: string): LocalMetadata {
  const metadata: LocalMetadata = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripLogLinePrefix(rawLine).trim();
    const title = line.match(/^- \*\*Title:\*\*\s*(.+)$/);
    if (title) {
      metadata.title = title[1].trim();
      continue;
    }
    const author = line.match(/^- \*\*Author:\*\*\s*(.+)$/);
    if (author) {
      metadata.author = author[1].trim();
      continue;
    }
    const branch = line.match(/^- \*\*Branch:\*\*\s*(.+?)\s*→\s*(.+)$/);
    if (branch) {
      metadata.headBranch = branch[1].trim();
      metadata.baseBranch = branch[2].trim();
      continue;
    }
    if (line.startsWith('### Additional Context')) {
      const idx = raw.indexOf(rawLine);
      const tail = raw.slice(idx).split(/\r?\n/).slice(1);
      const contextLines: string[] = [];
      for (const tailLine of tail) {
        const cleaned = stripLogLinePrefix(tailLine).trim();
        if (!cleaned || cleaned.startsWith('###') || cleaned === '<diff>' || cleaned.startsWith('<diff path=')) break;
        contextLines.push(cleaned);
      }
      if (contextLines.length > 0) {
        metadata.customPrompt = contextLines.join('\n');
      }
      break;
    }
  }

  return metadata;
}

/**
 * Normalize diff input from:
 * - raw unified git diffs
 * - GitHub Actions debug logs (`2026-06-17T07:18:04.0467177Z ##[debug]…`)
 * - per-file `<diff path="…">…</diff>` blocks
 * - legacy `<diff>…</diff>` blocks with optional ```diff fences
 */
export function normalizeDiffInput(raw: string): NormalizedDiffInput {
  const metadata = extractLogMetadata(raw);

  const perFileBlocks = extractPerFileDiffBlocks(raw);
  if (perFileBlocks.length > 0) {
    return { diff: cleanDiffLines(perFileBlocks.join('\n')), metadata };
  }

  let text = raw;
  const legacyBlocks: string[] = [];
  const blockRe = /<diff>([\s\S]*?)<\/diff>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    legacyBlocks.push(blockMatch[1]);
  }
  const legacyBlock = legacyBlocks.find((b) => b.includes('diff --git'));
  if (legacyBlock) {
    text = legacyBlock;
  } else {
    const fenced = text.match(/```diff\s*([\s\S]*?)```/i);
    if (fenced) {
      text = fenced[1];
    }
  }

  let diff = cleanDiffLines(text);

  if (!diff.includes('diff --git')) {
    const match = raw.match(/^diff --git[\s\S]*/m);
    if (match) {
      diff = cleanDiffLines(match[0]);
    }
  }

  return { diff, metadata };
}

function loadFilesFromDir(rootDir: string): FileContent[] {
  const contents: FileContent[] = [];

  function walk(currentDir: string, relPrefix: string): void {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
        continue;
      }
      contents.push({
        path: relPath,
        content: fs.readFileSync(fullPath, 'utf8'),
        truncated: false,
      });
    }
  }

  walk(rootDir, '');
  return contents;
}

function loadMetadata(filePath: string): LocalMetadata {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LocalMetadata;
}

function buildPullRequestData(
  diff: string,
  metadata?: LocalMetadata,
  filesDir?: string,
): PullRequestData {
  const fileDiffs = splitDiffByFile(diff);
  const changedFiles = fileDiffs.map((f) => f.filePath);
  const reviewedFiles = fileDiffs.filter((f) => !f.isDeleted).map((f) => f.filePath);

  let fileContents: FileContent[] = metadata?.fileContents ?? [];
  if (filesDir) {
    const fromDir = loadFilesFromDir(filesDir);
    const byPath = new Map(fileContents.map((f) => [f.path, f]));
    for (const file of fromDir) {
      byPath.set(file.path, file);
    }
    fileContents = [...byPath.values()];
  }

  return {
    number: metadata?.number ?? 0,
    title: metadata?.title ?? 'Local diff review',
    body: metadata?.body ?? '',
    diff,
    baseBranch: metadata?.baseBranch ?? 'main',
    headBranch: metadata?.headBranch ?? 'local',
    author: metadata?.author ?? 'local',
    changedFiles,
    reviewedFiles,
    ignoredFiles: [],
    redactionCount: 0,
    fileContents,
  };
}

function resolveApiKey(provider: CliOptions['provider']): string {
  const envByProvider: Record<CliOptions['provider'], string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    azure: ['AZURE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  };

  for (const envName of envByProvider[provider]) {
    const value = process.env[envName];
    if (value) return value;
  }

  if (provider === 'azure' && HARDCODED_AZURE_API_KEY) {
    return HARDCODED_AZURE_API_KEY;
  }

  console.error(
    `API key required. Set one of: ${envByProvider[provider].join(', ')}` +
      (provider === 'azure' ? ', or edit HARDCODED_AZURE_API_KEY in run-agent-local.ts' : ''),
  );
  process.exit(1);
}

function resolveAzureEndpoint(): string {
  return process.env.AZURE_ENDPOINT || HARDCODED_AZURE_ENDPOINT;
}

function makeConfig(options: CliOptions, logMetadata?: LocalMetadata): ReviewConfig {
  const apiKey = resolveApiKey(options.provider);
  const model = options.model ?? DEFAULT_MODELS[options.provider];
  const azureEndpoint = resolveAzureEndpoint();

  if (options.provider === 'azure' && !azureEndpoint) {
    console.error(
      'AZURE_ENDPOINT is required when --provider azure. Set the env var or edit HARDCODED_AZURE_ENDPOINT in run-agent-local.ts',
    );
    process.exit(1);
  }

  return {
    provider: options.provider,
    apiKey,
    model,
    azureEndpoint,
    githubToken: '',
    categories: {
      security: { enabled: true, guidelines: DEFAULT_GUIDELINES.security },
      tests: { enabled: true, guidelines: DEFAULT_GUIDELINES.tests },
      performance: { enabled: true, guidelines: DEFAULT_GUIDELINES.performance },
      code: { enabled: true, guidelines: DEFAULT_GUIDELINES.code },
      custom: { enabled: false, guidelines: '' },
    },
    customPrompt: logMetadata?.customPrompt ?? '',
    extraInstructions: '',
    maxDiffSize: 600_000,
    postReviewComment: false,
    postInlineComments: false,
    failOnCritical: false,
    ignorePatterns: [],
    redactSecrets: false,
    timeoutMs: 120_000,
    includeFileContents: true,
    contextFiles: [],
    maxFileSize: 100_000,
  };
}

function loadFindingsInput(filePath: string): FindingsInput {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw) as FindingsInput;
    if (!Array.isArray(parsed.specialistResults)) {
      throw new Error('Findings JSON must include a "specialistResults" array');
    }
    return parsed;
  }
  if (raw.includes('### ') && raw.includes('Agent')) {
    return parseJudgeDebugLog(raw);
  }
  throw new Error(
    'Unrecognized findings file. Use specialist JSON or a GitHub Actions judge debug log.',
  );
}

/** Strip log prefixes from an entire file. */
function stripLogFile(raw: string): string {
  return raw.split(/\r?\n/).map(stripLogLinePrefix).join('\n');
}

/** Parse specialist findings from a judge user-prompt debug log. */
export function parseJudgeDebugLog(raw: string): FindingsInput {
  const text = stripLogFile(raw);
  const specialistResults: SpecialistResult[] = [];
  const enabledCategories: string[] = [];

  const sectionRe =
    /### .+? Agent(?: \(category id: "([^"]+)"\)|: FAILED \(([^)]+)\)|: No issues found ✓)\s*([\s\S]*?)(?=\n### .+? Agent|\n## Code Context|\n## PR:|\nVerify each finding|$)/g;

  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(text)) !== null) {
    const headerLine = match[0].split('\n')[0];
    const body = match[3] ?? '';

    const categoryMatch = headerLine.match(/category id: "([^"]+)"/);
    if (!categoryMatch) continue;

    const categoryId = categoryMatch[1];
    enabledCategories.push(categoryId);

    if (headerLine.includes('FAILED')) {
      const errMatch = headerLine.match(/FAILED \(([^)]+)\)/);
      specialistResults.push({
        categoryId,
        findings: [],
        tokens: { input: 0, output: 0 },
        failed: true,
        error: errMatch?.[1] ?? 'unknown error',
      });
      continue;
    }

    if (headerLine.includes('No issues found')) {
      specialistResults.push({
        categoryId,
        findings: [],
        tokens: { input: 0, output: 0 },
        failed: false,
      });
      continue;
    }

    const jsonBlock = body.match(/```json\s*([\s\S]*?)```/);
    const findings = jsonBlock
      ? parseSpecialistFindings(
          JSON.stringify({ findings: JSON.parse(jsonBlock[1].trim()) }),
          categoryId,
        )
      : [];

    specialistResults.push({
      categoryId,
      findings,
      tokens: { input: 0, output: 0 },
      failed: false,
    });
  }

  if (specialistResults.length === 0) {
    throw new Error('No specialist sections found in judge debug log');
  }

  return { enabledCategories, specialistResults };
}

/** Extract the code-context section from a judge debug log. */
function extractCodeContextFromJudgeLog(raw: string): string {
  const text = stripLogFile(raw);
  const marker = '## Code Context';
  const idx = text.indexOf(marker);
  if (idx === -1) return '';
  return text.slice(idx + marker.length).trim();
}

// ─── Agent runners ──────────────────────────────────────────────────

async function runOneSpecialist(
  categoryId: SpecialistId,
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const provider = createProvider(
    config.provider,
    config.apiKey,
    config.model,
    config.azureEndpoint,
  );
  const prioritizeTests = categoryId === 'tests';
  const sharedContext = buildSharedContext(pr, config, prioritizeTests);
  const guidelines = config.categories[categoryId];

  const result = await runSpecialistAgent(
    provider,
    categoryId,
    guidelines,
    pr,
    config,
    sharedContext,
  );

  return {
    agent: categoryId,
    failed: result.failed,
    error: result.error,
    findings: result.findings,
    tokens: result.tokens,
  };
}

async function runJudgeOnly(
  pr: PullRequestData,
  config: ReviewConfig,
  findingsInput: FindingsInput,
): Promise<object> {
  const provider = createProvider(
    config.provider,
    config.apiKey,
    config.model,
    config.azureEndpoint,
  );
  const enabledCategories =
    findingsInput.enabledCategories ??
    findingsInput.specialistResults.map((r) => r.categoryId);
  const sharedContext = buildSharedContext(pr, config);

  const judgeResult = await runJudge(
    provider,
    findingsInput.specialistResults,
    pr,
    config,
    sharedContext,
    enabledCategories,
  );

  return {
    agent: 'judge',
    summary: judgeResult.structured.summary,
    findings: judgeResult.structured.findings,
    tokens: judgeResult.tokens,
  };
}

async function runAllAgents(
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const specialists: Record<string, object> = {};
  const specialistResults: SpecialistResult[] = [];

  for (const categoryId of SPECIALIST_IDS) {
    console.error(`Running specialist: ${categoryId}...`);
    const result = (await runOneSpecialist(categoryId, pr, config)) as {
      failed?: boolean;
      error?: string;
      findings: SpecialistResult['findings'];
      tokens: SpecialistResult['tokens'];
    };
    specialists[categoryId] = result;

    specialistResults.push({
      categoryId,
      findings: result.findings,
      tokens: result.tokens,
      failed: Boolean(result.failed),
      error: result.error,
    });
  }

  console.error('Running judge...');
  const judge = await runJudgeOnly(pr, config, {
    enabledCategories: [...SPECIALIST_IDS],
    specialistResults,
  });

  return { specialists, judge };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.agent === 'judge' && !options.findingsFile) {
    console.error('Judge-only mode requires --findings <file>, or use --agent all');
    process.exit(1);
  }

  let rawInput: string;
  let logMetadata: LocalMetadata = {};

  if (options.diffFile && fs.existsSync(options.diffFile)) {
    rawInput = fs.readFileSync(options.diffFile, 'utf8');
  } else if (options.agent === 'judge' && options.findingsFile && fs.existsSync(options.findingsFile)) {
    if (options.diffFile) {
      console.error(`Diff file not found: ${options.diffFile}`);
      console.error(`Using code context from ${options.findingsFile} instead`);
    } else {
      console.error(`No diff file provided — extracting code context from ${options.findingsFile}`);
    }
    const findingsRaw = fs.readFileSync(options.findingsFile, 'utf8');
    const codeContext = extractCodeContextFromJudgeLog(findingsRaw);
    if (!codeContext) {
      console.error(
        'No ## Code Context section in findings file. Pass a diff file: Debug/securitylogs.txt',
      );
      process.exit(1);
    }
    rawInput = codeContext;
    logMetadata = extractLogMetadata(findingsRaw);
  } else {
    console.error(`Diff file not found: ${options.diffFile ?? '(not provided)'}`);
    process.exit(1);
  }

  if (!rawInput.trim()) {
    console.error('Diff input is empty');
    process.exit(1);
  }

  const { diff, metadata: diffMetadata } = normalizeDiffInput(rawInput);
  if (!diff.trim()) {
    console.error('Could not extract a unified diff from the input file');
    process.exit(1);
  }

  const fileMetadata = options.metadataFile ? loadMetadata(options.metadataFile) : undefined;
  const metadata: LocalMetadata = { ...logMetadata, ...diffMetadata, ...fileMetadata };
  const pr = buildPullRequestData(diff, metadata, options.filesDir);
  const config = makeConfig(options, metadata);

  const fileCount = splitDiffByFile(diff).length;
  if (fileCount === 0) {
    console.error('Parsed diff contains no file hunks (expected "diff --git" headers)');
    process.exit(1);
  }

  console.error(
    `Agent: ${options.agent} | Provider: ${config.provider} | Model: ${config.model}`,
  );
  console.error(
    `PR context: "${pr.title}" | ${fileCount} diff file(s) | ${pr.fileContents.length} full file(s)`,
  );

  let result: object;

  if (options.agent === 'all') {
    result = await runAllAgents(pr, config);
  } else if (options.agent === 'judge') {
    const findingsInput = loadFindingsInput(options.findingsFile!);
    result = await runJudgeOnly(pr, config, findingsInput);
  } else {
    result = await runOneSpecialist(options.agent, pr, config);
  }

  const json = JSON.stringify(result, null, 2);
  if (options.outputFile) {
    fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
    fs.writeFileSync(options.outputFile, json);
    console.error(`Wrote ${options.outputFile}`);
  } else {
    console.log(json);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
