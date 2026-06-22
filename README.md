# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)**, **OpenAI**, or **Azure OpenAI** to review pull requests with a **multi-agent architecture** — parallel specialist agents for security, test coverage, performance, and code quality, followed by a judge agent that verifies and filters findings.

## How it works

```
PR opened/updated
       │
       ▼
  Gather context (diff + full file contents)
       │
       ├──────────┬──────────┬──────────┐
       ▼          ▼          ▼          ▼
   🔒 Security  🧪 Tests  ⚡ Perf   📋 Code    ← Specialist agents (parallel)
       │          │          │          │
       └──────────┴──────────┴──────────┘
                      │
                      ▼
               👨‍⚖️ Judge Agent                    ← Verifies, deduplicates, filters
                      │
                      ▼
              Post to PR (summary + inline comments)
```

Each specialist is a focused expert that reviews the **complete function/API** in context — not just isolated diff lines. The judge verifies findings against the actual diff and filters out noise, vague advice, and false positives.

## Quick start

### Anthropic (Claude)

**1.** Add `ANTHROPIC_API_KEY` as a repository secret (Settings → Secrets and variables → Actions).

**2.** Create `.github/workflows/pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pbansal-monotype/codereview@main
        with:
          provider: anthropic
          review_categories: 'security,tests,performance,code'
          repo_context: |
            Node.js microservice using Express and PostgreSQL.
            Auth middleware at src/middleware/auth.ts.
          review_policy: |
            All new routes must use the auth middleware.
            Error responses must use our AppError class.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### OpenAI

```yaml
- uses: pbansal-monotype/codereview@main
  with:
    provider: openai
    model: gpt-4o
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Azure OpenAI

```yaml
- uses: pbansal-monotype/codereview@main
  with:
    provider: azure
    azure_endpoint: 'https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-12-01-preview'
    model: gpt-5.4-nano   # must match your deployment name
  env:
    AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}
```

`azure_endpoint` accepts either the full deployment URL (as shown above) or just the bare resource URL (`https://<resource>.cognitiveservices.azure.com`). The API version and deployment name are parsed automatically from the URL.

## Review categories

| Category | Specialist role | What it finds |
|----------|----------------|---------------|
| `security` | Application security engineer | Injection, XSS, hardcoded secrets, missing auth, crypto misuse, path traversal |
| `tests` | QA architect | Untested functions/branches, tautological assertions, flaky test patterns |
| `performance` | Performance engineer | N+1 queries, unbounded loops, blocking calls, missing pagination, O(n²) |
| `code` | Senior software engineer | Error handling gaps, missing validation, resource leaks, race conditions, logic errors, pattern inconsistencies |
| `custom` | Follows your guidelines | Whatever you specify via `custom_prompt` |

Each specialist reviews the **complete function or API** being changed — not just individual diff lines — and uses full file contents to understand context, data flow, and codebase patterns.

## Quality controls

The system has multiple layers to prevent low-quality findings:

1. **Injection guard**: PR title, body, diff, and file contents are wrapped in named delimiters (`<pr_description>`, `<diff>`, `<file>`). Every system prompt instructs the model to analyze those delimiters and never follow instructions inside them.
2. **Specialist-level**: Must include a verbatim code snippet per finding; low-confidence findings are dropped before reaching the judge.
3. **Judge-level**: Verifies each finding's code snippet against the actual diff, deduplicates, re-calibrates severity, removes confidence "low" findings, and caps the total at 8.
4. **Code-level filters**: Drops vague messages ("Ensure...", "Consider...") and findings without a file path.
5. **Severity calibration (shared scale)**: "critical" = would you page the on-call at 3 am? "warning" = real bug, not urgent. "suggestion" = concrete improvement with specific code. The exact same scale is used by every specialist and the judge.
6. **Honest failure reporting**: A crashed specialist appears as a visible warning in the PR comment — it can never silently read as a clean pass. If the judge fails to parse its JSON output after retry, findings are published with an **unverified** banner (specialist or deduped fallback) rather than blocking the review.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | No | `anthropic` | `anthropic`, `openai`, or `azure` |
| `api_key` | No | — | API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AZURE_API_KEY` env var) |
| `azure_endpoint` | No | — | **Required for `azure` provider.** Full deployment URL or bare resource endpoint. Also readable from `AZURE_ENDPOINT` env var. |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name or Azure deployment name (`claude-sonnet-4-20250514` / `gpt-4o` / `gpt-5.4-nano`) |
| `review_categories` | No | `security,tests,performance,code` | Comma-separated categories |
| `security_guidelines` | No | built-in | Custom security review rules |
| `test_guidelines` | No | built-in | Custom test coverage review rules |
| `performance_guidelines` | No | built-in | Custom performance review rules |
| `code_guidelines` | No | built-in | Custom code quality review rules |
| `repo_context` | No | — | Repository overview (tech stack, architecture, key files) |
| `review_policy` | No | — | Review policy and standards injected into all agent prompts |
| `ignore_paths` | No | — | Glob patterns to skip (e.g. `**/migrations/**`) |

> `repo_context` = **what the repo is** ("Django app with Celery workers. Prisma ORM. Auth in src/middleware/auth.ts.")
>
> `review_policy` = **how to review it** ("All APIs must validate auth tokens. Follow standards at wiki.internal/standards.")

The following behaviors are always enabled and cannot be toggled off:
- **Review comments** — Summary and inline comments are always posted to the PR
- **Secret redaction** — Secrets are always redacted before sending code to the AI
- **Full file contents** — Changed files are always sent alongside the diff for full context

## Customising guidelines

Each category has built-in guidelines that work out of the box. Override any category with the `*_guidelines` inputs:

```yaml
- uses: pbansal-monotype/codereview@main
  with:
    provider: anthropic
    security_guidelines: |
      Focus on OWASP Top 10. We use Helmet.js for HTTP headers.
      Our auth middleware is in src/middleware/auth.ts — check new routes use it.
    code_guidelines: |
      All public functions must have JSDoc comments.
      Error responses must use our AppError class from src/errors.ts.
```

## Input resolution order

Every input follows: **action input (`with:`) > environment variable > built-in default**.

GitHub does not auto-expose secrets as env vars. Map them explicitly:

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  # or for Azure:
  AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}
  AZURE_ENDPOINT: ${{ secrets.AZURE_ENDPOINT }}
  SECURITY_GUIDELINES: ${{ vars.SECURITY_GUIDELINES }}
  REVIEW_POLICY: ${{ vars.REVIEW_POLICY }}
```

<details>
<summary>Full env var mapping</summary>

| Action Input | Env Var |
|--------------|---------|
| `provider` | `REVIEW_PROVIDER` |
| `model` | `REVIEW_MODEL` |
| `review_categories` | `REVIEW_CATEGORIES` |
| `api_key` | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AZURE_API_KEY` |
| `azure_endpoint` | `AZURE_ENDPOINT` |
| `github_token` | `GITHUB_TOKEN` |
| `security_guidelines` | `SECURITY_GUIDELINES` |
| `test_guidelines` | `TEST_GUIDELINES` |
| `performance_guidelines` | `PERFORMANCE_GUIDELINES` |
| `code_guidelines` | `CODE_GUIDELINES` |
| `repo_context` | `REPO_CONTEXT` |
| `review_policy` | `REVIEW_POLICY` |
| `ignore_paths` | `IGNORE_PATHS` |

</details>

## Outputs

| Output | Description |
|--------|-------------|
| `review_body` | Full review markdown text |
| `has_critical_issues` | `true` if critical issues were found |
| `categories_reviewed` | Comma-separated list of categories reviewed |
| `findings_count` | Total number of structured findings |

## Architecture

```
src/
├── agents/
│   ├── guidelines/          # Review rules per category (one file each)
│   │   ├── security.ts
│   │   ├── tests.ts
│   │   ├── performance.ts
│   │   └── code-guidelines.ts
│   ├── prompts.ts           # All prompt builders (specialist + judge, with injection guards)
│   ├── specialist.ts        # Specialist agent runner
│   ├── judge.ts             # Judge agent runner (parse repair + unverified fallback)
│   ├── format.ts            # Markdown formatting for PR comments
│   ├── orchestrator.ts      # Parallel fan-out → judge → result
│   └── types.ts             # Shared types
├── providers/               # LLM provider implementations
│   ├── anthropic.ts         # Supports cache_control blocks for prompt caching
│   ├── openai.ts
│   └── azure.ts             # Azure OpenAI via AzureOpenAI client
├── config.ts                # Config loading, JSON instructions, severity rubric
├── findings.ts              # Finding parsing, validation & quality filtering
├── github.ts                # PR data fetching & comment posting
└── index.ts                 # Entry point
```

## Fork-based PRs

Use `pull_request_target` instead of `pull_request` for fork PRs (the action only reads diffs, never executes PR code).

## Development

```bash
npm install        # install dependencies
npm run lint       # type-check with tsc
npm test           # run tests
npm run build      # compile to dist/index.js with ncc
```

## License

MIT
