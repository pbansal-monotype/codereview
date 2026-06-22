import * as core from '@actions/core';
import { parseIgnorePatterns } from './context/ignore';
import { DEFAULT_GUIDELINES } from './agents/guidelines';
import type { StoreType } from './state';

export interface CategoryGuidelines {
  enabled: boolean;
  guidelines: string;
}

export interface ReviewConfig {
  provider: 'anthropic' | 'openai' | 'azure';
  apiKey: string;
  model: string;
  /** Required when provider is "azure". Bare resource endpoint or full deployment URL. */
  azureEndpoint: string;
  githubToken: string;
  categories: {
    security: CategoryGuidelines;
    tests: CategoryGuidelines;
    performance: CategoryGuidelines;
    code: CategoryGuidelines;
    custom: CategoryGuidelines;
  };
  repoContext: string;
  reviewPolicy: string;
  ignorePatterns: string[];
  stateStore: StoreType;
  stateGistId: string;
  incrementalReview: boolean;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  azure: 'gpt-5.4-nano',
};

/** Token budget helpers — rough estimate: 1 token ≈ 4 characters of English/code text. */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
export function tokensToChars(tokens: number): number {
  return tokens * 4;
}

/**
 * Maximum tokens to include in any single prompt (shared context).
 * Specialists and judge both operate within this ceiling.
 * 75 000 tokens ≈ 300 000 chars, matching model context windows for claude-sonnet-4.
 */
export const MAX_PROMPT_TOKENS = 75_000;

/** Timeout per LLM API call in milliseconds. */
export const TIMEOUT_MS = 120_000;

/** Maximum characters per file when including file contents. */
export const MAX_FILE_SIZE = 10_000;

/** Shared severity scale — identical wording used in both specialist and judge prompts. */
export const SEVERITY_RUBRIC = `Severity scale (identical for all agents):
- "critical": would you page the on-call engineer at 3 am? Data loss, auth bypass, crash, secret exposure.
- "warning": real bug but not urgent — will cause problems but not tonight.
- "suggestion": concrete improvement with specific code; a reasonable engineer would skip it without regret.`;

// ─── JSON output instructions ──────────────────────────────────────

const SPECIALIST_JSON_INSTRUCTION = `
You MUST respond with valid JSON. You may optionally wrap it in a \`\`\`json fence. Schema:
{
  "findings": [
    {
      "severity": "critical" | "warning" | "suggestion",
      "confidence": "high" | "medium" | "low",
      "file": "path/to/file.ts",
      "line": 42,
      "codeSnippet": "verbatim 1-3 line excerpt of the problematic code (exact text from the file)",
      "message": "What is wrong → Why it matters → How to fix it"
    }
  ]
}

${SEVERITY_RUBRIC}

RULES:
- Every finding MUST have a file and a codeSnippet (verbatim excerpt of the problematic lines). A line number is helpful but the snippet is the ground truth for verification.
- Message format: "[What] → [Why] → [How]" — all three parts required.
- "confidence": "high" = you can prove the issue from the code. "medium" = strong inference from patterns and context. "low" = speculating (omit these).
- An empty findings array is a GOOD response. Don't manufacture issues.
- ❌ Never: "Ensure...", "Consider...", "Make sure...", "Verify that..." — these are not findings.
- ❌ Never flag env vars, standard try/catch, or normal error logging.`;

export function getSpecialistJsonInstruction(): string {
  return SPECIALIST_JSON_INSTRUCTION;
}

const JUDGE_DEDUP_JSON_INSTRUCTION = `
You MUST respond with valid JSON. You may optionally wrap it in a \`\`\`json fence. Schema:
{
  "findings": [
    {
      "category": "<category_id>",
      "severity": "critical" | "warning" | "suggestion",
      "confidence": "high" | "medium" | "low",
      "file": "path/to/file.ts",
      "line": 42,
      "codeSnippet": "verbatim 1-3 line excerpt of the problematic code",
      "message": "..."
    }
  ]
}

Return a single valid JSON object with a "findings" array. No markdown. No text outside the JSON.`;

const JUDGE_REWRITE_JSON_INSTRUCTION = `
You MUST respond with valid JSON. You may optionally wrap it in a \`\`\`json fence. Schema:
{
  "summary": "<2-4 sentences: what the PR does, overall quality, critical blockers if any>",
  "findings": [
    {
      "category": "<category_id>",
      "severity": "critical" | "warning" | "suggestion",
      "confidence": "high" | "medium",
      "file": "path/to/file.ts",
      "line": 42,
      "codeSnippet": "verbatim 1-3 line excerpt of the problematic code",
      "message": "<Sentence 1. Sentence 2. Sentence 3.>"
    }
  ]
}

Return a single valid JSON object. No markdown. No text outside the JSON.`;

export function getJudgeDedupJsonInstruction(): string {
  return JUDGE_DEDUP_JSON_INSTRUCTION;
}

export function getJudgeRewriteJsonInstruction(): string {
  return JUDGE_REWRITE_JSON_INSTRUCTION;
}

/** @deprecated Use getJudgeRewriteJsonInstruction */
export function getJudgeJsonInstruction(): string {
  return getJudgeRewriteJsonInstruction();
}

// ─── Config loading ────────────────────────────────────────────────

function bool(value: string, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

const ENV_VAR_NAMES: Record<string, string> = {
  provider: 'REVIEW_PROVIDER',
  model: 'REVIEW_MODEL',
  review_categories: 'REVIEW_CATEGORIES',
  repo_context: 'REPO_CONTEXT',
  review_policy: 'REVIEW_POLICY',
  security: 'SECURITY_GUIDELINES',
  tests: 'TEST_GUIDELINES',
  performance: 'PERFORMANCE_GUIDELINES',
  code: 'CODE_GUIDELINES',
  ignore_paths: 'IGNORE_PATHS',
  github_token: 'GITHUB_TOKEN',
  azure_endpoint: 'AZURE_ENDPOINT',
  state_store: 'STATE_STORE',
  state_gist_id: 'STATE_GIST_ID',
  incremental_review: 'INCREMENTAL_REVIEW',
};

function resolve(inputName: string, fallback = ''): string {
  return core.getInput(inputName) || process.env[ENV_VAR_NAMES[inputName]] || fallback;
}

const SECRET_NAMES: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  azure: 'AZURE_API_KEY',
};

function resolveApiKey(provider: 'anthropic' | 'openai' | 'azure'): string {
  const fromInput = core.getInput('api_key');
  if (fromInput) return fromInput;

  const envName = SECRET_NAMES[provider];
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;

  throw new Error(
    `No API key found. Either set the "api_key" input or add a "${envName}" secret to your repository.`,
  );
}

export function loadConfig(): ReviewConfig {
  const provider = resolve('provider', 'anthropic') as 'anthropic' | 'openai' | 'azure';

  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'azure') {
    throw new Error(`Invalid provider "${provider}". Use "anthropic", "openai", or "azure".`);
  }

  const model = resolve('model') || DEFAULT_MODELS[provider];

  const enabledCategories = resolve('review_categories', 'security,tests,performance,code')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  function resolveGuidelines(category: string): CategoryGuidelines {
    const actionInput = core.getInput(`${category}_guidelines`);
    const fromEnv = process.env[ENV_VAR_NAMES[category]];

    return {
      enabled: enabledCategories.includes(category),
      guidelines: actionInput || fromEnv || DEFAULT_GUIDELINES[category] || '',
    };
  }

  const apiKey = resolveApiKey(provider);
  const githubToken = resolve('github_token');
  if (!githubToken) {
    throw new Error('No github_token provided and GITHUB_TOKEN env var is not set.');
  }

  const azureEndpoint = resolve('azure_endpoint');
  if (provider === 'azure' && !azureEndpoint) {
    throw new Error(
      'Provider "azure" requires an endpoint URL. Set the "azure_endpoint" input or AZURE_ENDPOINT env var.',
    );
  }

  return {
    provider,
    apiKey,
    model,
    azureEndpoint,
    githubToken,
    categories: {
      security: resolveGuidelines('security'),
      tests: resolveGuidelines('tests'),
      performance: resolveGuidelines('performance'),
      code: resolveGuidelines('code'),
      custom: {
        enabled: enabledCategories.includes('custom'),
        guidelines: resolve('repo_context'),
      },
    },
    repoContext: resolve('repo_context'),
    reviewPolicy: resolve('review_policy'),
    ignorePatterns: parseIgnorePatterns(resolve('ignore_paths')),
    stateStore: (resolve('state_store', 'comment-marker') as StoreType),
    stateGistId: resolve('state_gist_id'),
    incrementalReview: bool(resolve('incremental_review'), true),
  };
}

/**
 * Back-compat alias — prefer MAX_PROMPT_TOKENS for new code.
 * Kept so callers that import MAX_PROMPT_CHARS still compile.
 */
export const MAX_PROMPT_CHARS = MAX_PROMPT_TOKENS * 4; // 300 000 chars
