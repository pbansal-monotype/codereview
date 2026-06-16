import * as core from '@actions/core';
import { parseIgnorePatterns } from './ignore';
import { DEFAULT_GUIDELINES } from './agents/guidelines';

export interface CategoryGuidelines {
  enabled: boolean;
  guidelines: string;
}

export interface ReviewConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  githubToken: string;
  categories: {
    security: CategoryGuidelines;
    tests: CategoryGuidelines;
    performance: CategoryGuidelines;
    cost: CategoryGuidelines;
    custom: CategoryGuidelines;
  };
  customPrompt: string;
  extraInstructions: string;
  maxDiffSize: number;
  postReviewComment: boolean;
  postInlineComments: boolean;
  failOnCritical: boolean;
  ignorePatterns: string[];
  redactSecrets: boolean;
  timeoutMs: number;
  includeFileContents: boolean;
  contextFiles: string[];
  maxFileSize: number;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
};

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
      "message": "What is wrong → Why it matters → How to fix it"
    }
  ]
}

RULES:
- Every finding MUST have a file and line number from the changed code.
- Message format: "[What] → [Why] → [How]" — all three parts required.
- "confidence": "high" = you can prove the issue from the code. "medium" = strong inference from patterns and context. "low" = speculating (omit these).
- Severity: "critical" = would you wake the on-call at 3am? "warning" = real bug but not urgent. "suggestion" = concrete improvement with specific code.
- An empty findings array is a GOOD response. Don't manufacture issues.
- Max 4 findings. Keep only the most important ones.
- ❌ Never: "Ensure...", "Consider...", "Make sure...", "Verify that..." — these are not findings.
- ❌ Never flag env vars, standard try/catch, or normal error logging.`;

export function getSpecialistJsonInstruction(): string {
  return SPECIALIST_JSON_INSTRUCTION;
}

const JUDGE_JSON_INSTRUCTION = `
You MUST respond with valid JSON. You may optionally wrap it in a \`\`\`json fence. Schema:
{
  "summary": "1-3 sentence overall assessment of the PR",
  "findings": [
    {
      "category": "<category_id>",
      "severity": "critical" | "warning" | "suggestion",
      "confidence": "high" | "medium" | "low",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "What is wrong → Why it matters → How to fix it"
    }
  ]
}

ONLY include findings that passed your verification. Empty findings = clean PR = good outcome.`;

export function getJudgeJsonInstruction(): string {
  return JUDGE_JSON_INSTRUCTION;
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
  custom_prompt: 'CUSTOM_PROMPT',
  extra_instructions: 'EXTRA_INSTRUCTIONS',
  security: 'SECURITY_GUIDELINES',
  tests: 'TEST_GUIDELINES',
  performance: 'PERFORMANCE_GUIDELINES',
  cost: 'COST_GUIDELINES',
  max_diff_size: 'MAX_DIFF_SIZE',
  post_review_comment: 'POST_REVIEW_COMMENT',
  post_inline_comments: 'POST_INLINE_COMMENTS',
  fail_on_critical: 'FAIL_ON_CRITICAL',
  ignore_paths: 'IGNORE_PATHS',
  redact_secrets: 'REDACT_SECRETS',
  timeout: 'REVIEW_TIMEOUT',
  include_file_contents: 'INCLUDE_FILE_CONTENTS',
  context_files: 'CONTEXT_FILES',
  max_file_size: 'MAX_FILE_SIZE',
  github_token: 'GITHUB_TOKEN',
};

function resolve(inputName: string, fallback = ''): string {
  return core.getInput(inputName) || process.env[ENV_VAR_NAMES[inputName]] || fallback;
}

const SECRET_NAMES: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

function resolveApiKey(provider: 'anthropic' | 'openai'): string {
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
  const provider = resolve('provider', 'anthropic') as 'anthropic' | 'openai';

  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Invalid provider "${provider}". Use "anthropic" or "openai".`);
  }

  const model = resolve('model') || DEFAULT_MODELS[provider];

  const enabledCategories = resolve('review_categories', 'security,tests,performance,cost')
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

  const timeoutSec = parseInt(resolve('timeout', '120'), 10);

  return {
    provider,
    apiKey,
    model,
    githubToken,
    categories: {
      security: resolveGuidelines('security'),
      tests: resolveGuidelines('tests'),
      performance: resolveGuidelines('performance'),
      cost: resolveGuidelines('cost'),
      custom: {
        enabled: enabledCategories.includes('custom'),
        guidelines: resolve('custom_prompt'),
      },
    },
    customPrompt: resolve('custom_prompt'),
    extraInstructions: resolve('extra_instructions'),
    maxDiffSize: parseInt(resolve('max_diff_size', '60000'), 10),
    postReviewComment: bool(resolve('post_review_comment'), true),
    postInlineComments: bool(resolve('post_inline_comments'), true),
    failOnCritical: bool(resolve('fail_on_critical'), false),
    ignorePatterns: parseIgnorePatterns(resolve('ignore_paths')),
    redactSecrets: bool(resolve('redact_secrets'), true),
    timeoutMs: timeoutSec * 1000,
    includeFileContents: bool(resolve('include_file_contents'), true),
    contextFiles: resolve('context_files')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
    maxFileSize: parseInt(resolve('max_file_size', '10000'), 10),
  };
}

/**
 * Safe cross-model default for maximum combined prompt size (chars).
 * ~300K chars ≈ ~75K tokens, well within both Claude (200K) and GPT-4o (128K) limits.
 */
export const MAX_PROMPT_CHARS = 300_000;
