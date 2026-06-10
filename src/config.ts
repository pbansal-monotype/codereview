import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
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

function loadConfigFile(configPath: string): Record<string, unknown> {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    core.info(`No config file found at ${fullPath}, using action inputs and defaults`);
    return {};
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const parsed = parseYaml(content) as Record<string, unknown>;
  core.info(`Loaded review config from ${fullPath}`);
  return parsed ?? {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
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
  const configPath = core.getInput('config_path');
  const fileConfig = loadConfigFile(configPath);

  const provider = (core.getInput('provider') ||
    str(fileConfig.provider) ||
    'anthropic') as 'anthropic' | 'openai';

  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Invalid provider "${provider}". Use "anthropic" or "openai".`);
  }

  const model =
    core.getInput('model') || str(fileConfig.model) || DEFAULT_MODELS[provider];

  const enabledCategories = (
    core.getInput('review_categories') ||
    str(fileConfig.review_categories) ||
    'security,tests,performance,cost'
  )
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  const guidelinesFromFile = (fileConfig.guidelines ?? {}) as Record<string, string>;

  function resolveGuidelines(category: string): CategoryGuidelines {
    const inputKey = `${category}_guidelines`;
    const actionInput = core.getInput(inputKey);
    const fileGuideline = guidelinesFromFile[category];

    return {
      enabled: enabledCategories.includes(category),
      guidelines: actionInput || fileGuideline || DEFAULT_GUIDELINES[category] || '',
    };
  }

  const ignoreInput =
    core.getInput('ignore_paths') || str(fileConfig.ignore_paths);

  const timeoutSec = parseInt(
    core.getInput('timeout') || str(fileConfig.timeout) || '120',
    10,
  );

  const apiKey = resolveApiKey(provider);
  const githubToken =
    core.getInput('github_token') ||
    process.env.GITHUB_TOKEN ||
    '';
  if (!githubToken) {
    throw new Error('No github_token provided and GITHUB_TOKEN env var is not set.');
  }

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
        guidelines:
          core.getInput('custom_prompt') || guidelinesFromFile.custom || '',
      },
    },
    customPrompt: core.getInput('custom_prompt') || str(fileConfig.custom_prompt),
    extraInstructions:
      core.getInput('extra_instructions') || str(fileConfig.extra_instructions),
    maxDiffSize: parseInt(
      core.getInput('max_diff_size') || str(fileConfig.max_diff_size) || '60000',
      10,
    ),
    postReviewComment: bool(
      core.getInput('post_review_comment') || fileConfig.post_review_comment,
      true,
    ),
    postInlineComments: bool(
      core.getInput('post_inline_comments') || fileConfig.post_inline_comments,
      true,
    ),
    failOnCritical: bool(
      core.getInput('fail_on_critical') || fileConfig.fail_on_critical,
      false,
    ),
    ignorePatterns: parseIgnorePatterns(ignoreInput),
    redactSecrets: bool(
      core.getInput('redact_secrets') || fileConfig.redact_secrets,
      true,
    ),
    timeoutMs: timeoutSec * 1000,
    includeFileContents: bool(
      core.getInput('include_file_contents') || fileConfig.include_file_contents,
      true,
    ),
    contextFiles: (
      core.getInput('context_files') || str(fileConfig.context_files)
    )
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
    maxFileSize: parseInt(
      core.getInput('max_file_size') || str(fileConfig.max_file_size) || '10000',
      10,
    ),
  };
}

export function getJsonOutputInstruction(): string {
  return JSON_OUTPUT_INSTRUCTION;
}
