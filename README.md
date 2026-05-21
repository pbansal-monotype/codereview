# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)** or **OpenAI** to review pull requests against your company's custom guidelines for security, test coverage, performance, cost, and more.

## Features

- **Dual AI support** — switch between Anthropic Claude and OpenAI GPT with a single input
- **Inline review comments** — posts findings directly on the affected lines in the diff
- **Configurable review categories** — security, tests, performance, cost, and custom
- **Company guidelines** — pass your own review guidelines via a config file or action inputs
- **Custom prompts** — send additional context or instructions to the AI
- **Smart comments** — posts a single review comment and updates it on new pushes
- **Fail on critical** — reliably gates on structured `critical` findings (with text fallback)
- **Secret redaction** — strips API keys, tokens, and credentials from diffs before LLM calls
- **File ignore patterns** — skips lockfiles, binaries, `dist/`, and custom globs
- **Smart diff truncation** — prioritizes source code files when truncating large diffs
- **Single combined review** — one API call per PR (lower cost and latency)
- **Cost estimation** — shows approximate dollar cost per review in the stats
- **Retry with backoff** — handles rate limits and transient AI errors with timeout
- **Config file support** — centralize guidelines in `.github/pr-review-config.yml`

## Quick Start

### 1. Add secrets to your repository

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (if using Claude) |
| `OPENAI_API_KEY` | Your OpenAI API key (if using GPT) |

### 2. Create the workflow

Create `.github/workflows/pr-review.yml`:

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
          provider: 'anthropic'
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### 3. (Optional) Add a config file

Create `.github/pr-review-config.yml` to centralize your company's guidelines. See [`pr-review-config.example.yml`](./pr-review-config.example.yml) for a full example.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | Yes | `anthropic` | AI provider: `anthropic` or `openai` |
| `api_key` | Yes | — | API key for the AI provider |
| `github_token` | Yes | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name (defaults to `claude-sonnet-4-20250514` / `gpt-4o`) |
| `config_path` | No | `.github/pr-review-config.yml` | Path to config file |
| `review_categories` | No | `security,tests,performance,cost` | Categories to review |
| `security_guidelines` | No | built-in | Custom security guidelines |
| `test_guidelines` | No | built-in | Custom test review guidelines |
| `performance_guidelines` | No | built-in | Custom performance guidelines |
| `cost_guidelines` | No | built-in | Custom cost review guidelines |
| `custom_prompt` | No | — | Repo-specific context (tech stack, architecture) |
| `extra_instructions` | No | — | Company-wide policies for the system prompt (tone, standards) |
| `max_diff_size` | No | `60000` | Max diff characters before smart truncation |
| `post_review_comment` | No | `true` | Post review summary as a PR comment |
| `post_inline_comments` | No | `true` | Post inline comments on specific diff lines |
| `fail_on_critical` | No | `false` | Fail the action on critical issues |
| `ignore_paths` | No | — | Extra comma-separated globs to skip |
| `redact_secrets` | No | `true` | Redact secrets before sending diff to AI |
| `timeout` | No | `120` | Timeout in seconds for each AI API call |

> **`custom_prompt` vs `extra_instructions`:** Use `custom_prompt` for repo-specific context
> (e.g. "This is a Django app using PostgreSQL"). Use `extra_instructions` for company-wide
> policies (e.g. "Be concise. Follow our coding standards at wiki.internal/standards").

## Outputs

| Output | Description |
|--------|-------------|
| `review_body` | Full review markdown text |
| `has_critical_issues` | `true` if critical issues were found |
| `categories_reviewed` | Comma-separated list of reviewed categories |
| `findings_count` | Number of structured findings returned |

## Configuration File

The config file (`.github/pr-review-config.yml`) lets you version-control your review guidelines. Action inputs override config file values when both are set.

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
  custom: |
    Ensure API endpoints follow REST conventions...
```

## Examples

### Use OpenAI instead of Claude

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'openai'
    api_key: ${{ secrets.OPENAI_API_KEY }}
    model: 'gpt-4o'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Only review security and tests

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    review_categories: 'security,tests'
```

### Pass inline guidelines

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    security_guidelines: |
      We use Django ORM — check for raw SQL queries.
      Ensure all views have @login_required.
    custom_prompt: |
      This is a Python Django monolith with Celery workers.
```

### Fail CI on critical issues

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    fail_on_critical: 'true'
```

### Disable inline comments (summary only)

```yaml
- uses: your-org/ai-pr-reviewer@v1
  with:
    provider: 'anthropic'
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    post_inline_comments: 'false'
```

## Fork-based PRs (`pull_request_target`)

If your repository receives PRs from forks (common in open source or cross-team setups),
the `pull_request` trigger cannot access repository secrets. Use `pull_request_target` instead:

```yaml
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
```

> **Security note:** `pull_request_target` runs in the context of the base branch, so it
> has access to secrets. However, you should **never** run untrusted code from the PR
> (e.g. `npm install` on the PR branch) in this context. This action only reads the diff
> and metadata — it does not execute PR code, so it is safe to use with `pull_request_target`.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

CI runs lint, tests, and build on every push/PR (see `.github/workflows/ci.yml`).

## How It Works

1. **Trigger** — the action runs on `pull_request` events
2. **Fetch** — retrieves the PR diff and metadata via the GitHub API
3. **Filter** — removes ignored files, redacts secrets, smart-truncates large diffs
4. **Review** — sends all categories to the AI in a single call with your guidelines
5. **Post** — creates a summary comment + inline comments on affected lines
6. **Gate** — optionally fails the CI check if critical issues are found

## License

MIT
