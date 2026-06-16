# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)** or **OpenAI** to review pull requests against your company's custom guidelines for security, test coverage, performance, cost, and more.

Your team defines the rules. The AI enforces them on every PR — automatically.

---

## Why this exists

Code reviews are expensive. Senior engineers spend hours reading diffs, and critical issues still slip through. Static analyzers catch syntax and lint errors, but they can't reason about business logic, architecture patterns, or company-specific policies.

This action fills that gap. It sends your PR diff to an LLM with your company's guidelines and posts structured, actionable findings — both as a summary comment and as inline comments on the exact lines that need attention.

## Key capabilities

| Capability | What it does |
|------------|-------------|
| **Inline review comments** | Posts findings directly on the affected lines in the PR diff |
| **5 review categories** | Security, test coverage, performance, cost/infrastructure, and custom |
| **Company guidelines** | Your rules, your standards — all configurable in one workflow file |
| **Structured findings** | AI returns machine-parseable JSON with severity, file, line, and message |
| **CI gating** | Optionally fail the build when critical issues are found |
| **Secret redaction** | Strips API keys, tokens, PEM keys, and connection strings before sending to AI |
| **Smart truncation** | Prioritizes source code over configs when diffs exceed the token budget |
| **Cost transparency** | Shows estimated dollar cost per review in the stats footer |
| **Dual provider** | Switch between Claude and GPT with a single config change |

## Quick start

Two options — centralized (recommended for teams) or self-managed.

### Option A: Centralized (recommended)

The API key lives in **this repo only**. Consumer repos don't need any secrets — just a 10-line workflow file.

**One-time setup (admin):** Add `ANTHROPIC_API_KEY` as a secret in the `pbansal-monotype/codereview` repo.

**In each consumer repo**, create `.github/workflows/pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    uses: pbansal-monotype/codereview/.github/workflows/pr-review.yml@main
    with:
      provider: 'anthropic'
      review_categories: 'security,tests,performance,cost'
      custom_prompt: |
        This is a Node.js microservice using Express and PostgreSQL.
    secrets: inherit
```

That's it. No API keys in consumer repos. The reusable workflow reads the key from `pbansal-monotype/codereview`'s secrets.

### Option B: Self-managed (each repo has its own key)

Add `ANTHROPIC_API_KEY` as a secret in the consumer repo, then:

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
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4

      - uses: pbansal-monotype/codereview@main
        with:
          provider: 'anthropic'
          review_categories: 'security,tests,performance,cost'
          fail_on_critical: 'true'

          security_guidelines: |
            - Check for SQL injection, XSS, CSRF
            - No hardcoded secrets or credentials
            - All endpoints must have auth middleware
          test_guidelines: |
            - New features must have unit tests (>80% branch coverage)
            - Mock external services, never call them in tests
          performance_guidelines: |
            - No N+1 queries — use eager loading
            - API responses must be paginated
          cost_guidelines: |
            - New cloud resources must be tagged
            - Avoid logging full request/response bodies

          custom_prompt: |
            This is a Node.js microservice using Express and PostgreSQL.
          extra_instructions: |
            Be constructive and specific. No nitpicking formatting.
```

Every PR now gets a full AI review.

## How it works

```
PR opened/updated
       |
       v
  Fetch diff + metadata via GitHub API
       |
       v
  Filter ignored files (lockfiles, binaries, dist/)
       |
       v
  Redact secrets (API keys, tokens, PEM keys)
       |
       v
  Smart-truncate if diff exceeds budget (source code first)
       |
       v
  Fetch full contents of changed files (for context)
       |
       v
  Send diff + file contents + guidelines to AI in a single call
       |
       v
  Parse structured JSON response
       |
       v
  Post summary comment + inline comments on affected lines
       |
       v
  Optionally fail CI if critical issues found
```

## All inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | Yes | `anthropic` | AI provider: `anthropic` or `openai` |
| `api_key` | Yes | — | API key for the AI provider |
| `github_token` | Yes | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name (defaults to `claude-sonnet-4-20250514` / `gpt-4o`) |
| `review_categories` | No | `security,tests,performance,cost` | Comma-separated categories to review |
| `security_guidelines` | No | built-in | Security review rules |
| `test_guidelines` | No | built-in | Test coverage review rules |
| `performance_guidelines` | No | built-in | Performance review rules |
| `cost_guidelines` | No | built-in | Cost/infrastructure review rules |
| `custom_prompt` | No | — | Repo-specific context (tech stack, architecture) |
| `extra_instructions` | No | — | Company-wide policies for the system prompt |
| `max_diff_size` | No | `60000` | Max diff characters before smart truncation |
| `post_review_comment` | No | `true` | Post the summary comment on the PR |
| `post_inline_comments` | No | `true` | Post inline comments on specific diff lines |
| `fail_on_critical` | No | `false` | Fail the CI check on critical findings |
| `ignore_paths` | No | — | Extra globs to skip (e.g. `**/migrations/**`) |
| `redact_secrets` | No | `true` | Redact secrets before sending diff to AI |
| `timeout` | No | `120` | Timeout in seconds per AI API call |
| `include_file_contents` | No | `true` | Send full file contents alongside diff for better context |
| `context_files` | No | — | Extra files to always include (e.g. `src/types.ts,src/db/schema.prisma`) |
| `max_file_size` | No | `10000` | Max characters per file when including contents |

> **`custom_prompt` vs `extra_instructions`**
>
> `custom_prompt` is **repo-specific context** — "This is a Django app using PostgreSQL with Celery workers."
>
> `extra_instructions` is **company-wide policy** — "Be concise. Follow coding standards at wiki.internal/standards."

### Input resolution order

Every input follows the same priority chain:

| Priority | Source | Who sets it |
|----------|--------|-------------|
| 1 (highest) | Action input (`with:`) | Per-repo workflow |
| 2 | Environment variable | Org or repo-level GitHub variable |
| 3 (lowest) | Built-in default | Action code |

**Org-wide setup:** Set org-level GitHub variables in your GitHub org settings (Settings > Variables). These are inherited by all repos automatically — no extra config files needed. Individual repos can override with repo-level variables or action inputs.

**Env var mapping:**

| Action Input | Env Var |
|--------------|---------|
| `provider` | `REVIEW_PROVIDER` |
| `model` | `REVIEW_MODEL` |
| `review_categories` | `REVIEW_CATEGORIES` |
| `security_guidelines` | `SECURITY_GUIDELINES` |
| `test_guidelines` | `TEST_GUIDELINES` |
| `performance_guidelines` | `PERFORMANCE_GUIDELINES` |
| `cost_guidelines` | `COST_GUIDELINES` |
| `custom_prompt` | `CUSTOM_PROMPT` |
| `extra_instructions` | `EXTRA_INSTRUCTIONS` |
| `max_diff_size` | `MAX_DIFF_SIZE` |
| `post_review_comment` | `POST_REVIEW_COMMENT` |
| `post_inline_comments` | `POST_INLINE_COMMENTS` |
| `fail_on_critical` | `FAIL_ON_CRITICAL` |
| `ignore_paths` | `IGNORE_PATHS` |
| `redact_secrets` | `REDACT_SECRETS` |
| `timeout` | `REVIEW_TIMEOUT` |
| `include_file_contents` | `INCLUDE_FILE_CONTENTS` |
| `context_files` | `CONTEXT_FILES` |
| `max_file_size` | `MAX_FILE_SIZE` |

`api_key` and `github_token` use their own env vars (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` and `GITHUB_TOKEN`).

## Outputs

| Output | Description |
|--------|-------------|
| `review_body` | Full review markdown text |
| `has_critical_issues` | `true` if critical issues were found |
| `categories_reviewed` | Comma-separated list of categories reviewed |
| `findings_count` | Total number of structured findings |

## More examples

### Minimal setup (uses built-in guidelines)

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Use OpenAI instead of Claude

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'openai'
    api_key: ${{ secrets.OPENAI_API_KEY }}
    model: 'gpt-4o'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Review only security and tests

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    review_categories: 'security,tests'
```

### Add a custom review category

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    review_categories: 'security,tests,custom'
    custom_prompt: |
      Check for compliance with our API design guidelines:
      - REST endpoints follow /api/v{n}/resource naming
      - All endpoints return { data, error, meta } envelope
      - Breaking changes require a version bump
```

### Always include key files for context

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    context_files: 'src/types.ts,src/middleware/auth.ts,prisma/schema.prisma'
```

### Diff-only mode (no file contents, lower cost)

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    include_file_contents: 'false'
```

## Fork-based PRs

If your repository receives PRs from forks, the `pull_request` trigger cannot access secrets. Use `pull_request_target` instead:

```yaml
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
```

> **Security:** This action only reads the diff and metadata — it never executes code from the PR, so it is safe to use with `pull_request_target`.

## Architecture

```
src/
├── index.ts              Entry point — orchestration, error handling
├── config.ts             Config loading from action inputs
├── review.ts             Prompt construction, response formatting
├── github.ts             GitHub API — diff fetching, comments, inline reviews
├── findings.ts           Structured JSON parsing and validation
├── diff-parser.ts        Diff parsing for inline comment targeting
├── cost.ts               Per-model cost estimation
├── sanitize.ts           API key redaction from error messages
├── redact.ts             Secret redaction from diffs
├── retry.ts              Retry with exponential backoff + timeout
├── ignore.ts             File ignore pattern matching
└── providers/
    ├── types.ts           AIProvider interface
    ├── anthropic.ts       Claude integration
    ├── openai.ts          GPT integration
    └── index.ts           Provider factory
```

## Development

```bash
npm install        # install dependencies
npm run lint       # type-check with tsc
npm test           # run 31 tests across 8 suites
npm run build      # compile to dist/index.js with ncc
```

## License

MIT
