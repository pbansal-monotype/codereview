import * as core from '@actions/core';
import { parseIgnorePatterns } from './ignore';

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

const DEFAULT_GUIDELINES: Record<string, string> = {
  security: `Flag ONLY concrete, exploitable security issues visible in the changed code.
You MUST point to the specific line(s) and explain the attack vector.

Flag these when you see actual vulnerable code:
- User input flows into SQL/NoSQL queries without parameterisation (show the data flow)
- User input rendered into HTML/templates without escaping (show the sink)
- Secrets, API keys, passwords, or tokens hardcoded as string literals (quote the value pattern)
- Missing auth/authz checks on a new route or endpoint (show the unprotected handler)
- Dangerous deserialization of untrusted input (e.g. eval, pickle.loads, yaml.load without SafeLoader)
- Cryptographic misuse you can prove (e.g. ECB mode, MD5 for passwords, static IV)
- Path traversal where user input reaches filesystem APIs without sanitisation

DO NOT flag:
- Generic "ensure input is validated" without showing the actual unvalidated input
- Speculative issues ("could potentially leak") without pointing to the leaking code
- Error messages that include non-sensitive info (stack traces in dev mode, HTTP status codes)
- Use of environment variables (they are the CORRECT way to handle config)
- Anything in test files unless real secrets are committed`,

  tests: `Flag ONLY specific, concrete gaps in test coverage for the changed code.
You MUST reference the untested function/branch/line and explain what scenario is missing.

Flag these when the evidence is clear:
- A new public function/method/endpoint with zero test coverage (name the function)
- An explicit error/edge-case branch (e.g. catch block, null check, boundary) that has no corresponding test
- A test that asserts nothing meaningful (e.g. only checks truthiness, or the assertion is tautological)
- A test that will always pass regardless of implementation (e.g. mocks return the asserted value)
- Flaky patterns: tests depending on timing, global state, or execution order

DO NOT flag:
- "Consider adding more tests" without naming the specific untested path
- Style preferences about test organisation (AAA, describe nesting, test naming)
- Missing tests for trivial getters/setters/pass-through wrappers
- That mocks are used (mocks are a standard testing tool; only flag if a mock hides a real bug)
- Missing integration/e2e tests unless the change is specifically an integration point`,

  performance: `Flag ONLY performance issues where you can point to the problematic code pattern and explain the scaling impact.

Flag these with specific evidence:
- A database/API call inside a loop where N is unbounded or user-controlled (show the loop + call)
- An unbounded query (SELECT * without LIMIT on a user-facing endpoint)
- O(n²) or worse algorithm where n can be large (show the nested iteration and what n represents)
- Synchronous blocking call (e.g. fs.readFileSync, sleep) in an async request handler
- Accumulating data in memory without bounds (e.g. pushing to an array in a stream handler)
- Missing pagination on a list endpoint that could return thousands of rows

DO NOT flag:
- "Consider caching" without showing what's being redundantly computed/fetched
- Performance of code that runs once at startup or in a CLI script
- Micro-optimisations (string concatenation style, forEach vs for-of on small arrays)
- Missing database indexes (you cannot see the schema or query plan from a diff)
- Async/await usage in non-hot-path code`,

  cost: `Flag ONLY cost issues where the code change will directly cause measurable spend increase.
You MUST estimate the magnitude or explain the scaling risk.

Flag these with concrete evidence:
- New provisioning of cloud resources in IaC (Terraform, CloudFormation, Pulumi) without size limits
- API calls to paid services (OpenAI, Twilio, Stripe, etc.) in a loop or hot path without rate limiting
- Writing to storage (S3, GCS, database) proportional to request volume without TTL or cleanup
- Logging at DEBUG/TRACE level enabled in production config (show the log level setting)
- Data transfer patterns that cross region/cloud boundaries in the hot path

DO NOT flag:
- Use of any cloud service in general (that's just how software works)
- Theoretical "could scale poorly" without showing the scaling dimension
- Logging at INFO/WARN/ERROR level (these are expected in production)
- One-time migration scripts or batch jobs
- Cost of compute that's proportional to legitimate user traffic`,
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
- Every finding MUST have a file and line number. If you can't point to a specific line, don't create the finding.
- Message format: "[What] → [Why] → [How]" — all three parts required.
- "confidence": "high" = you can see the bug. "medium" = inferring from patterns. "low" = speculating (prefer to omit).
- Severity: "critical" = would you wake the on-call? "warning" = real bug but not urgent. "suggestion" = concrete improvement.
- An empty findings array is a GOOD response. Don't manufacture issues.
- Max 4 findings. Keep only the most important ones.
- ❌ Never: "Ensure...", "Consider...", "Make sure...", "Verify that..." — these are not findings.
- ❌ Never flag unchanged lines, env vars, standard try/catch, or normal error logging.`;

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
