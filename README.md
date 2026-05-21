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

### 1. Add your API key as a secret

Go to **Settings > Secrets and variables > Actions** and add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` if using GPT).

### 2. Create one workflow file

Add `.github/workflows/pr-review.yml` to your repository. That's it — **one file, everything configured inline**:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: your-org/ai-pr-reviewer@v1
        with:
          # ── Provider ──────────────────────────────────────────
          provider: 'anthropic'
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          # model: 'claude-sonnet-4-20250514'    # optional override

          # ── Categories to review ──────────────────────────────
          review_categories: 'security,tests,performance,cost'

          # ── Company guidelines (inline) ───────────────────────
          security_guidelines: |
            - Check for SQL injection, XSS, CSRF
            - No hardcoded secrets or credentials
            - All endpoints must have auth middleware
            - Watch for insecure deserialization
          test_guidelines: |
            - New features must have unit tests (>80% branch coverage)
            - Edge cases and error paths must be tested
            - Mock external services, never call them in tests
          performance_guidelines: |
            - No N+1 queries — use eager loading
            - API responses must be paginated
            - Heavy work must go to background queues
          cost_guidelines: |
            - New cloud resources must be tagged
            - Avoid logging full request/response bodies
            - Check for unbounded storage growth

          # ── Repo context ──────────────────────────────────────
          custom_prompt: |
            This is a Node.js microservice using Express and PostgreSQL.
            We use TypeScript throughout. Pay attention to type safety.

          # ── Company-wide policies ─────────────────────────────
          extra_instructions: |
            Be constructive and specific. No nitpicking formatting.
            Reference file names and line numbers in every finding.

          # ── Behavior ──────────────────────────────────────────
          fail_on_critical: 'true'
          post_inline_comments: 'true'
          redact_secrets: 'true'
          # ignore_paths: '**/migrations/**,**/*.generated.ts'
          # timeout: '120'
          # max_diff_size: '60000'
```

Every PR now gets a full AI review — no extra config files needed.

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
| `config_path` | No | `.github/pr-review-config.yml` | Path to optional config file (see below) |

> **`custom_prompt` vs `extra_instructions`**
>
> `custom_prompt` is **repo-specific context** — "This is a Django app using PostgreSQL with Celery workers."
>
> `extra_instructions` is **company-wide policy** — "Be concise. Follow coding standards at wiki.internal/standards."

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

## Optional: external config file

If your guidelines are long or shared across many repos, you can extract them to a separate file. Create `.github/pr-review-config.yml`:

```yaml
provider: anthropic
review_categories: security,tests,performance,cost
fail_on_critical: true

extra_instructions: |
  You are reviewing code for Acme Corp.
  Be constructive and specific.

guidelines:
  security: |
    Check for SQL injection, XSS, hardcoded secrets...
  tests: |
    New code must have unit tests with >80% coverage...
  performance: |
    No N+1 queries, use pagination for lists...
  cost: |
    Tag all cloud resources, check log volume...
```

The action auto-loads this file if it exists. Action inputs override config file values when both are set.

See [`pr-review-config.example.yml`](./pr-review-config.example.yml) for a complete example.

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
├── config.ts             Config loading from file + action inputs
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
