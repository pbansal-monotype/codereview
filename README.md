# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)** or **OpenAI** to review pull requests with a **multi-agent architecture** — parallel specialist agents for security, test coverage, performance, and code quality, followed by a judge agent that verifies and filters findings.

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

**1. Add `ANTHROPIC_API_KEY`** (or `OPENAI_API_KEY`) as a secret in your repo or org (Settings > Secrets).

**2. Create `.github/workflows/pr-review.yml`**:

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
          review_categories: 'security,tests,performance,code'
          fail_on_critical: 'true'
          custom_prompt: |
            This is a Node.js microservice using Express and PostgreSQL.
```

That's it. Every PR now gets a multi-agent AI review.

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

1. **Specialist-level**: Max 4 findings each, must include file + line + evidence
2. **Judge-level**: Verifies findings against the diff, deduplicates, re-calibrates severity
3. **Code-level filters**: Drops low-confidence findings, vague messages ("Ensure...", "Consider..."), and caps total at 8
4. **Severity calibration**: "critical" = would you page the on-call at 3am? If not, it's downgraded.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | No | `anthropic` | `anthropic` or `openai` |
| `api_key` | No | — | API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env var) |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name (`claude-sonnet-4-20250514` / `gpt-4o`) |
| `review_categories` | No | `security,tests,performance,code` | Comma-separated categories |
| `security_guidelines` | No | built-in | Custom security review rules |
| `test_guidelines` | No | built-in | Custom test coverage review rules |
| `performance_guidelines` | No | built-in | Custom performance review rules |
| `code_guidelines` | No | built-in | Custom code quality review rules |
| `custom_prompt` | No | — | Repo-specific context (tech stack, architecture) |
| `extra_instructions` | No | — | Company-wide policies appended to all agent prompts |
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
> `extra_instructions` = **company-wide policy** ("All APIs must validate auth tokens. Follow standards at wiki.internal/standards.")

## Customising guidelines

Each category has built-in guidelines that work out of the box. Override any category with the `*_guidelines` inputs:

```yaml
- uses: pbansal-monotype/codereview@main
  with:
    provider: 'anthropic'
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
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  SECURITY_GUIDELINES: ${{ vars.SECURITY_GUIDELINES }}
  EXTRA_INSTRUCTIONS: ${{ vars.EXTRA_INSTRUCTIONS }}
```

<details>
<summary>Full env var mapping</summary>

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
| `code_guidelines` | `CODE_GUIDELINES` |
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
│   ├── prompts.ts           # All prompt builders (specialist + judge)
│   ├── specialist.ts        # Specialist agent runner
│   ├── judge.ts             # Judge agent runner
│   ├── format.ts            # Markdown formatting for PR comments
│   ├── orchestrator.ts      # Parallel fan-out → judge → result
│   └── types.ts             # Shared types
├── providers/               # LLM provider implementations
│   ├── anthropic.ts
│   └── openai.ts
├── config.ts                # Config loading & JSON instructions
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
