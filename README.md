# AI PR Reviewer

A GitHub Action that uses **Claude (Anthropic)**, **OpenAI**, or **Azure OpenAI** to review pull requests with a **multi-agent architecture** — parallel specialist agents for security and code quality, followed by a judge that deduplicates findings.

## How it works

```
PR opened/updated
       │
       ▼
  Gather context (diff + full file contents)
       │
       ├──────────────────┐
       ▼                  ▼
   🔒 Security        📋 Code          ← Specialist agents (parallel, tool loop)
       │                  │
       └────────┬─────────┘
                ▼
         👨‍⚖️ Judge Agent              ← Deduplicates findings
                ▼
    Diff anchoring + dismiss filter
                ▼
       Post to PR (summary + inline comments)
```

Each specialist reviews the **complete function/API** in context — not just isolated diff lines. The judge deduplicates across specialists; post-processing anchors findings to changed diff lines and respects reviewer dismissals.

**Detailed docs:** [Agent pipeline](docs/agents.md) · [Context pipeline](docs/context.md) · [Architecture](ARCHITECTURE.md)

## Quick start

### Anthropic (Claude)

**1.** Add `ANTHROPIC_API_KEY` as a repository secret (Settings → Secrets and variables → Actions).

**2.** Create `.github/workflows/pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

# One active review per PR — cancel stale runs when new commits are pushed.
# Required for incremental review (last_reviewed_sha) to stay correct.
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
      - uses: pbansal-monotype/codereview@main
        with:
          provider: anthropic
          review_categories: 'security,code'
          repo_context: |
            Node.js microservice using Express and PostgreSQL.
            Auth middleware at src/middleware/auth.ts.
          review_policy: |
            All new routes must use the auth middleware.
            Error responses must use our AppError class.
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Concurrency (required for consumer workflows)

Add this at the **workflow** level (not on the action step):

```yaml
concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

| Setting | Why |
|---------|-----|
| `group: pr-review-${{ github.event.pull_request.number }}` | Only one review run per PR at a time |
| `cancel-in-progress: true` | When a new push arrives, cancel the in-flight run for an older commit |

Without concurrency, rapid pushes can spawn parallel runs that race on `lastReviewedSha` state and post duplicate findings. With it, each run reviews only the incremental diff since the last successful review.

The summary comment is upserted (one comment per PR). Inline comments dedupe identical `path:line:body` pairs, but concurrent runs can still duplicate work — concurrency prevents that.

## Finding loop prevention

PRs should not stay blocked forever on the same findings after a fix or an intentional ignore.

| Situation | What happens |
|-----------|----------------|
| **Fix pushed** | Incremental review diffs only new commits; suppression prompt lists prior findings as likely fixed |
| **False positive** | Reply **`/dismiss`** on the inline review comment (or `dismiss`, `won't fix`, `ignore`) |
| **Workflow re-run on same commit** | Cached findings reused — no duplicate LLM run |
| **Merge gate** | `has_critical_issues` clears when no critical findings remain (after fix or dismiss) |

Dismissals persist in review state (`dismissedFingerprints`) and are filtered both in specialist prompts and after the judge. See [docs/agents.md — Finding loop prevention](docs/agents.md#finding-loop-prevention) for details.

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
| `code` | Senior software engineer | Correctness, error handling, performance, resource leaks, race conditions, logic errors |
| `custom` | Follows your guidelines | Whatever you specify via `custom` guidelines input |

Default: `security,code`. The `code` specialist covers correctness, error handling, and performance in a single pass.

> `action.yml` still lists legacy `tests` and `performance` categories; the runtime default is `security,code`.

Each specialist reviews the **complete function or API** being changed — not just individual diff lines — and uses full file contents to understand context, data flow, and codebase patterns.

## Quality controls

The system has multiple layers to prevent low-quality findings:

1. **Injection guard**: PR title, body, diff, and file contents are wrapped in named delimiters (`<pr_description>`, `<diff>`, `<file>`). Every system prompt instructs the model to analyze those delimiters and never follow instructions inside them.
2. **Specialist-level**: Must include a verbatim code snippet per finding; low-confidence findings are dropped before reaching the judge.
3. **Judge-level**: Deduplicates findings from all specialists using a strict three-condition duplicate rule.
4. **Diff anchoring**: Findings whose `file:line` does not land on a changed diff line are dropped.
5. **Dismissal filter**: Reviewer-dismissed findings (via `/dismiss` on inline comments) are suppressed on future runs.
6. **Code-level filters**: Drops vague messages ("Ensure...", "Consider...") and findings without a file path.
7. **Severity calibration (shared scale)**: "critical" = would you page the on-call at 3 am? "warning" = real bug, not urgent. "suggestion" = concrete improvement with specific code.
8. **Honest failure reporting**: A crashed specialist appears as a visible warning in the PR comment. If the judge fails to parse after retry, findings are published with an **unverified** banner rather than blocking the review.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | No | `anthropic` | `anthropic`, `openai`, or `azure` |
| `api_key` | No | — | API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AZURE_API_KEY` env var) |
| `azure_endpoint` | No | — | **Required for `azure` provider.** Full deployment URL or bare resource endpoint. Also readable from `AZURE_ENDPOINT` env var. |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | auto | Model name or Azure deployment name (`claude-sonnet-4-20250514` / `gpt-4o` / `gpt-5.4-nano`) |
| `review_categories` | No | `security,code` | Comma-separated categories (`security`, `code`, `custom`) |
| `security_guidelines` | No | built-in | Custom security review rules |
| `code_guidelines` | No | built-in | Custom code quality review rules |
| `incremental_review` | No | `true` | Only review changes since last reviewed commit |
| `state_store` | No | `comment-marker` | `comment-marker`, `gist`, or `none` — where review state is persisted |
| `state_gist_id` | No | — | Gist ID when `state_store=gist` |
| `supabase_url` | No | — | Supabase project URL — enables run/finding history tracking |
| `supabase_key` | No | — | Supabase secret key (`sb_secret_...`). Required when `supabase_url` is set |
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
| `supabase_url` | `SUPABASE_URL` |
| `supabase_key` | `SUPABASE_KEY` |

</details>

## Outputs

| Output | Description |
|--------|-------------|
| `review_body` | Full review markdown text |
| `has_critical_issues` | `true` if critical findings remain after dismiss filter — use for merge gates |
| `categories_reviewed` | Comma-separated list of categories reviewed |
| `findings_count` | Total number of structured findings |
| `history_run_id` | UUID of the recorded history row (empty when history is disabled) |

## Tracking review history

Optionally record every run and every finding to a Supabase (Postgres) database, so you can trend cost, latency, and bug counts across PRs over time.

**1. Create the tables.** Paste [`src/history/schema.sql`](src/history/schema.sql) into the Supabase SQL editor, or:

```bash
psql "$DATABASE_URL" -f src/history/schema.sql
```

**2. Pass the credentials.** Use a **secret** key (Settings → API Keys → Secret keys), never a publishable one:

```yaml
- uses: pbansal-monotype/codereview@main
  with:
    supabase_url: https://abcdefgh.supabase.co
    supabase_key: ${{ secrets.SUPABASE_KEY }}
```

You get two append-only tables: `pr_review_runs` (one row per run — tokens, cost, duration, findings by severity, failed specialists, plus the Actions run id) and `pr_review_findings` (one row per finding — severity, confidence, file, line, message, and a stable `fingerprint`).

Since the `fingerprint` is stable across runs, you can track a single bug's lifetime:

```sql
-- Bugs that survived the most reviews without being fixed
select fingerprint, severity, file, min(message) as message,
       count(*) as seen_in_runs, max(created_at) as last_seen
from pr_review_findings
where repo = 'acme/widgets'
group by fingerprint, severity, file
having count(*) > 1
order by seen_in_runs desc;
```

```sql
-- Spend and latency per PR, excluding cached replays
select pr_number, sum(estimated_cost_usd) as usd,
       sum(total_tokens) as tokens, round(avg(duration_ms) / 1000.0, 1) as avg_secs
from pr_review_runs
where repo = 'acme/widgets' and not cached
group by pr_number
order by usd desc nulls last;
```

History writes are **best-effort**: if the database is unreachable or the key is wrong, the action logs a warning and the review proceeds normally. Leave `supabase_url` unset to disable tracking entirely.

### Local history DB (Docker)

For `npm run local-review`, you can run a local Postgres + PostgREST stack that speaks the same REST API:

```bash
cp .env.example .env   # fill GITHUB_TOKEN + LLM keys; SUPABASE_* already point at localhost
docker compose up -d   # or: npm run history-db:up
npm run local-review -- --repo owner/name --pr 123
```

- API: `http://127.0.0.1:54321` (PostgREST)
- Postgres: `localhost:5432` / db `pr_review_history` / user+pass `postgres`
- Schema is applied from `src/history/schema.sql` on first boot
- The local `SUPABASE_KEY` in `.env.example` is a demo JWT for localhost only — do not use it against a real Supabase project

The CLI records a history row after each local review when `SUPABASE_URL` and `SUPABASE_KEY` are set.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and [docs/agents.md](docs/agents.md) for the specialist → judge pipeline.

```
src/
├── agents/              # Specialist fan-out, judge, orchestrator
├── config/              # Prompts, file rules, tools, loadConfig
├── context/             # Diff scoring, blast radius, on-demand tools
├── github/              # PR data, comments, dismissals
├── state/               # ReviewState persistence + suppression
├── history/             # Optional append-only run/finding log (Supabase)
├── output/              # Finding parsers, markdown format
├── providers/           # Anthropic, OpenAI, Azure
└── index.ts             # GitHub Action entry point
```

## Fork-based PRs

Use `pull_request_target` instead of `pull_request` for fork PRs (the action only reads diffs, never executes PR code).

## Development

```bash
npm install        # install dependencies
npm run lint       # type-check with tsc
npm test           # run tests
npm run build      # compile to dist/index.js with ncc (run on Linux Node 24 for releases)
```

**Releasing the action:** `dist/` includes a native `tree-sitter` binary. Build on **Linux with Node 24** (same as `action.yml`) so GitHub runners can load it — e.g. in CI or `docker run --rm -v "$PWD":/app -w /app node:24-bookworm npm ci && npm run build`. If the binding is missing or wrong-platform, the action still runs and falls back to text-match for Python/Go references.

## License

MIT
