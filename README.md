# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)** or **OpenAI** to review pull requests against your company's custom guidelines for security, test coverage, performance, cost, and more.

## Quick start

**1. Add `ANTHROPIC_API_KEY`** (or `OPENAI_API_KEY`) as a secret at your GitHub org level (Settings > Secrets) or in the individual repo.

**2. Create `.github/workflows/pr-review.yml`** in your repo:

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
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4

      - uses: pbansal-monotype/codereview@main
        with:
          provider: 'openai'
          review_categories: 'security,tests,performance,cost'
          fail_on_critical: 'true'
          security_guidelines: |
            - Check for SQL injection, XSS, CSRF
            - No hardcoded secrets or credentials
          custom_prompt: |
            This is a Node.js microservice using Express and PostgreSQL.
```

That's it. Every PR now gets an AI review.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | No | `anthropic` | `anthropic` or `openai` |
| `api_key` | No | — | API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env var) |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name (`claude-sonnet-4-20250514` / `gpt-4o`) |
| `review_categories` | No | `security,tests,performance,cost` | Comma-separated categories |
| `security_guidelines` | No | built-in | Security review rules |
| `test_guidelines` | No | built-in | Test coverage review rules |
| `performance_guidelines` | No | built-in | Performance review rules |
| `cost_guidelines` | No | built-in | Cost/infrastructure review rules |
| `custom_prompt` | No | — | Repo-specific context (tech stack, architecture) |
| `extra_instructions` | No | — | Company-wide policies for the system prompt |
| `max_diff_size` | No | `60000` | Max diff characters before truncation |
| `post_review_comment` | No | `true` | Post summary comment on PR |
| `post_inline_comments` | No | `true` | Post inline comments on diff lines |
| `fail_on_critical` | No | `false` | Fail CI on critical findings |
| `ignore_paths` | No | — | Glob patterns to skip (e.g. `**/migrations/**`) |
| `redact_secrets` | No | `true` | Redact secrets before sending to AI |
| `timeout` | No | `120` | Timeout in seconds per API call |
| `include_file_contents` | No | `true` | Send full file contents alongside diff |
| `context_files` | No | — | Extra files to always include for context |
| `max_file_size` | No | `10000` | Max characters per file |

> `custom_prompt` = **repo-specific context** ("This is a Django app with Celery workers.")
>
> `extra_instructions` = **company-wide policy** ("Be concise. Follow standards at wiki.internal/standards.")

## Input resolution order

Every input follows: **action input (`with:`) > environment variable > built-in default**.

**Important:** GitHub does not auto-expose secrets or variables as environment variables. You must explicitly pass them via the `env:` block in your workflow. For example, to make your API key available:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

`GITHUB_TOKEN` is the one exception — GitHub makes it available automatically, no mapping needed.

Any org-level or repo-level variable/secret you want the action to read must be mapped in `env:` the same way. For example, to set org-wide security guidelines:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  SECURITY_GUIDELINES: ${{ vars.SECURITY_GUIDELINES }}
  EXTRA_INSTRUCTIONS: ${{ vars.EXTRA_INSTRUCTIONS }}
```

The full env var mapping:

| Action Input | Env Var |
|--------------|---------|
| `provider` | `REVIEW_PROVIDER` |
| `model` | `REVIEW_MODEL` |
| `review_categories` | `REVIEW_CATEGORIES` |
| `api_key` | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| `github_token` | `GITHUB_TOKEN` |
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

## Outputs

| Output | Description |
|--------|-------------|
| `review_body` | Full review markdown text |
| `has_critical_issues` | `true` if critical issues were found |
| `categories_reviewed` | Comma-separated list of categories reviewed |
| `findings_count` | Total number of structured findings |

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
