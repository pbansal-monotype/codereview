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
  security: `Review for security vulnerabilities including:
- SQL injection, XSS, CSRF vulnerabilities
- Hardcoded secrets, API keys, or credentials
- Insecure deserialization or input handling
- Missing authentication/authorization checks
- Insecure cryptographic practices
- Path traversal or file inclusion risks
- Dependency vulnerabilities (known CVEs)
- Improper error handling that leaks sensitive info`,

  tests: `Review test coverage and quality:
- Are new code paths covered by unit tests?
- Are edge cases and error scenarios tested?
- Are integration tests needed for this change?
- Do tests follow AAA (Arrange-Act-Assert) pattern?
- Are mocks/stubs used appropriately?
- Are test descriptions clear and meaningful?
- Is there test data that could be sensitive?`,

  performance: `Review for performance concerns:
- N+1 query patterns or excessive DB calls
- Missing database indexes for new queries
- Unbounded loops or recursive calls
- Large memory allocations or memory leaks
- Missing pagination for list endpoints
- Synchronous operations that should be async
- Missing caching opportunities
- Inefficient algorithms (time/space complexity)`,

  cost: `Review for cost and infrastructure impact:
- New cloud resources or services being provisioned
- API calls to paid third-party services
- Data transfer costs (cross-region, egress)
- Storage growth implications
- Compute-intensive operations that could scale poorly
- Missing rate limiting or throttling
- Logging volume that could increase costs
- Database query patterns that affect billing`,
};

const JSON_OUTPUT_INSTRUCTION = `
You MUST respond with valid JSON only (no markdown fences). Schema:
{
  "summary": "1-3 sentence overall assessment",
  "findings": [
    {
      "category": "<category_id>",
      "severity": "critical" | "warning" | "suggestion",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Clear, actionable description"
    }
  ]
}
If no issues for a category, omit findings for that category. Use severity "critical" only for issues that must block merge. Always include "file" and "line" when possible.`;

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

// Action input -> env var -> fallback
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
  const provider = (resolve('provider', 'anthropic')) as 'anthropic' | 'openai';

  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Invalid provider "${provider}". Use "anthropic" or "openai".`);
  }

  const model = resolve('model') || DEFAULT_MODELS[provider];

  const enabledCategories = (resolve('review_categories', 'security,tests,performance,cost'))
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

export function getJsonOutputInstruction(): string {
  return JSON_OUTPUT_INSTRUCTION;
}
