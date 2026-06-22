# AI PR Reviewer — Architecture

A TypeScript GitHub Action that automates pull request code review using a multi-agent LLM pipeline. Runs on Node 20, bundled with `@vercel/ncc` into a single `dist/index.js`.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Specialist Agents | 5 (security, tests, performance, code, custom) |
| Judge Stages | 2 (dedup + rewrite) |
| Token Budget | ~75k tokens (~300k chars) |
| Max Findings | 8 per review |
| LLM Calls per PR | up to 7 (5 specialists + 2 judge) |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       GitHub Actions Runner                         │
│        pull_request → action.yml → dist/index.js (Node 20)          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
      ┌──────────┐     ┌──────────────┐    ┌─────────────┐
      │  Config  │     │  GitHub API  │    │ LLM Provider│
      │  inputs  │     │  diff, files │    │  Anthropic  │
      │  env vars│     │  comments    │    │  OpenAI     │
      └──────────┘     └──────────────┘    │  Azure      │
                               │           └─────────────┘
                      ┌────────┴────────┐        │
                      │ Context Builder │        │
                      │ risk score +    │        │
                      │ token budget    │        │
                      └────────┬────────┘        │
                               │                 │
            ┌──────────┬───────┼───────┬─────────┤
            ▼          ▼       ▼       ▼         ▼
        Security    Tests   Perf    Code      Custom    ← Specialists (parallel)
            │          │       │       │         │
            └──────────┴───────┼───────┴─────────┘
                               ▼
                      ┌────────────────┐
                      │ Judge: Dedup   │
                      └───────┬────────┘
                              ▼
                      ┌────────────────┐
                      │ Judge: Rewrite │
                      └───────┬────────┘
                              ▼
                      ┌────────────────┐
                      │  Format MD     │
                      └───────┬────────┘
                              ▼
               PR Summary Comment + Inline Comments
```

---

## Review Pipeline (Data Flow)

```
1. GitHub PR Event
   │
   ▼
2. loadConfig()                     ← action inputs + env vars + default guidelines
   │
   ▼
3. createProvider()                 ← Anthropic | OpenAI | Azure
   │
   ▼
4. getPullRequestData()
   ├── GitHub: pulls.get            (metadata)
   ├── GitHub: pulls.get            (diff format)
   ├── GitHub: pulls.listFiles      (all changed paths)
   ├── Filter ignored files         (glob patterns)
   ├── prepareDiffForReview()       → redact secrets, truncate at file boundaries
   └── fetchFileContents()          → full files from head branch (optional)
   │
   ▼
5. runReview() [orchestrator]
   ├── buildSharedContext()         → risk-scored diff + file contents within ~75k token budget
   │
   ├── Stage 1: Promise.allSettled(runSpecialistAgent × N)
   │     Each specialist:
   │       system prompt (role + guidelines + injection guard + JSON schema)
   │       user prompt   (PR metadata + context + review instructions)
   │       → provider.review() → parseSpecialistFindings()
   │
   ├── Stage 2: runJudge()
   │     ├── collectSpecialistFindings()
   │     ├── judge/dedup LLM call   → parseDedupedFindings()
   │     └── judge/rewrite LLM call → parseJudgeRewriteReview() → reconcileRewrittenFindings()
   │
   └── formatReviewMarkdown()
   │
   ▼
6. Outputs
   ├── core.setOutput(review_body, has_critical_issues, ...)
   ├── postReviewComment()          → upsert PR comment with marker
   ├── postInlineReview()           → inline comments on valid diff lines
   └── core.setFailed()             if critical + fail_on_critical
```

---

## Directory Structure

```
PR Review/
├── action.yml                    # GitHub Action metadata (inputs, outputs, entry point)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── dist/
│   └── index.js                  # Bundled output (ncc build)
├── src/
│   ├── index.ts                  # Entry point — orchestrates full pipeline
│   ├── config.ts                 # Action inputs, env vars, severity rubric, JSON schemas
│   ├── findings.ts               # Finding types, JSON parsing, validation, dedup
│   ├── redact.ts                 # Secret redaction before LLM calls
│   ├── sanitize.ts               # Error sanitization in logs
│   ├── retry.ts                  # Retry + timeout wrapper for LLM API calls
│   ├── cost.ts                   # Approximate token cost estimation
│   ├── agents/
│   │   ├── orchestrator.ts       # Fan-out to specialists → judge → format
│   │   ├── specialist.ts         # One LLM call per domain category
│   │   ├── judge.ts              # Two-stage: dedup findings, then rewrite + summarize
│   │   ├── prompts.ts            # System/user prompt builders with injection guards
│   │   ├── format.ts             # Renders final PR comment markdown
│   │   └── guidelines/           # Built-in review rules per category
│   ├── context/
│   │   ├── diff.ts               # Risk scoring, budget allocation, diff/file context
│   │   └── ignore.ts             # Glob-based file filtering
│   ├── github/
│   │   ├── pr-data.ts            # Fetch PR metadata, diff, changed files
│   │   ├── file-contents.ts      # Fetch full file contents from head branch
│   │   └── comments.ts           # Upsert summary comment, post inline comments
│   ├── providers/
│   │   ├── index.ts              # Uniform AIProvider.review() interface
│   │   ├── anthropic.ts          # Anthropic Claude API
│   │   ├── openai.ts             # OpenAI Chat Completions
│   │   └── azure.ts              # Azure OpenAI
│   └── __tests__/                # Node.js built-in test runner tests
└── .github/
    └── workflows/
        └── ci.yml                # CI: lint, test, build; self-reviews PRs
```

---

## Module Reference

| Module | Path | Responsibility |
|--------|------|----------------|
| **Entry** | `src/index.ts` | Top-level pipeline: config → fetch PR → review → post comments |
| **Config** | `src/config.ts` | Resolves action inputs, env vars, defaults; JSON schema + severity rubric |
| **Orchestrator** | `src/agents/orchestrator.ts` | Fan-out to specialists, collect results, run judge, format output |
| **Specialist** | `src/agents/specialist.ts` | One LLM call per domain category; parses JSON findings |
| **Judge** | `src/agents/judge.ts` | Two-stage: deduplicate findings, then rewrite messages + summary |
| **Prompts** | `src/agents/prompts.ts` | System/user prompt builders with injection guards |
| **Format** | `src/agents/format.ts` | Renders final PR markdown (findings, failures, cost stats) |
| **PR Data** | `src/github/pr-data.ts` | Fetches PR metadata, diff, changed files; filters ignored paths |
| **File Contents** | `src/github/file-contents.ts` | Fetches full file contents from PR head branch (concurrent, max 10) |
| **Comments** | `src/github/comments.ts` | Upserts summary comment; posts inline review comments |
| **Context** | `src/context/diff.ts` | Risk-scores files, allocates token budget, builds diff/file sections |
| **Ignore** | `src/context/ignore.ts` | Glob-based file filtering (lockfiles, dist, images, etc.) |
| **Providers** | `src/providers/` | Uniform `AIProvider` interface over Anthropic, OpenAI, Azure |
| **Findings** | `src/findings.ts` | Structured finding model; parsing, filtering, dedup, max 8 cap |
| **Redact** | `src/redact.ts` | Secret redaction before sending to LLMs |
| **Sanitize** | `src/sanitize.ts` | Strips API keys from failure messages in logs |
| **Retry** | `src/retry.ts` | Exponential backoff on 429/5xx/timeouts for LLM API calls |
| **Cost** | `src/cost.ts` | Approximate token cost estimation for review footer |

---

## Multi-Agent Topology

### Specialists (Stage 1 — Parallel)

Up to 5 specialist agents run concurrently via `Promise.allSettled`:

| Specialist | Focus |
|------------|-------|
| **Security** | Vulnerabilities, auth issues, injection risks, secret exposure |
| **Tests** | Missing tests, coverage gaps, test quality (uses test-prioritized file scoring) |
| **Performance** | N+1 queries, memory leaks, unnecessary computation, scalability |
| **Code Quality** | Readability, maintainability, error handling, best practices |
| **Custom** | User-defined review guidelines |

Each specialist receives:
- A **system prompt** with role definition, domain-specific guidelines, injection guard, and JSON output schema
- A **user prompt** with PR metadata + risk-scored context + review instructions

### Judge (Stage 2 — Sequential)

Two sequential LLM calls consolidate specialist output:

1. **Dedup** — Merges true duplicates across specialists while preserving all fields
2. **Rewrite** — Tightens finding messages, writes PR summary, reconciles onto deduped list

---

## Context Building Strategy

Files are risk-scored to fit within the ~75k token budget:

```
                     Risk Scoring
                          │
      ┌───────────────────┼───────────────────┐
      ▼                   ▼                   ▼
   High Risk           Medium Risk         Low Risk
   (score ≥ 0.6)       (score ≥ 0.3)       (score < 0.3)
      │                   │                   │
  Diff + Full File     Diff Only           Excluded
```

### Risk scoring factors:
- **Path patterns** — `auth`, `payment`, `migration`, `security` boost the score
- **Line count** — More changed lines = higher risk
- **New file bonus** — Newly added files get a score boost

---

## External Integrations

### GitHub REST API (via `@actions/github`)

| Operation | Purpose |
|-----------|---------|
| `pulls.get` | PR metadata + unified diff |
| `pulls.listFiles` | Changed file list |
| `repos.getContent` | Full file contents at PR head ref |
| `issues.listComments` / `createComment` / `updateComment` | Summary review comment (upsert by HTML marker) |
| `pulls.createReview` / `createReviewComment` | Inline diff comments |
| `pulls.listReviewComments` | Dedup existing inline comments |

**Permissions required:** `contents: read`, `pull-requests: write`

### LLM Providers

| Provider | SDK | Notes |
|----------|-----|-------|
| **Anthropic** | `@anthropic-ai/sdk` | `messages.create`, temp=0, supports `cache_control` blocks |
| **OpenAI** | `openai` | Chat Completions, `response_format: json_object` |
| **Azure OpenAI** | `openai` (`AzureOpenAI`) | Parses endpoint URL, uses deployment name as model |

All providers go through `withRetry()` — 3 attempts, exponential backoff, configurable timeout.

---

## Security Controls

| Control | Description |
|---------|-------------|
| **Secret Redaction** | Secrets are stripped from diffs and file contents before sending to LLMs (`redact.ts`) |
| **Injection Guards** | Untrusted PR content wrapped in `<pr_description>`, `<diff>`, `<file>` delimiters |
| **Error Sanitization** | API keys stripped from failure messages in logs (`sanitize.ts`) |
| **Fail-Closed Judge** | If judge parsing fails after retry, PR is treated as having critical issues |

---

## Finding Lifecycle

```
Specialist raw JSON
  → filter low confidence, vague messages, missing file/snippet
    → Judge dedup: preserve fields, merge true duplicates
      → Judge rewrite: tighten messages, write summary, reconcile
        → Final StructuredReview: max 8 findings (critical > warning > suggestion)
          → Posted as summary comment + inline comments
```

---

## Dependencies

### Runtime
- `@actions/core` — Logging, inputs/outputs, failure signaling
- `@actions/github` — GitHub context + Octokit client
- `@anthropic-ai/sdk` — Claude API (with prompt caching)
- `openai` — OpenAI Chat Completions + Azure OpenAI

### Dev
- `typescript` — Strict TS compilation
- `@vercel/ncc` — Bundles into single `dist/index.js`
- `@types/node` — Node 22 types

---

## Key Design Decisions

1. **Multi-agent over monolith** — Parallel domain experts plus a judge for quality control, rather than a single monolithic prompt
2. **Context over diff-only** — Full file contents for high-risk files so reviewers see complete functions/APIs
3. **Budget-aware context** — Risk scoring prevents blowing token limits on large PRs
4. **Quality gates at multiple layers** — Injection guards, specialist filters, judge dedup/rewrite, vague-message regex filters, 8-finding cap
5. **Resilient fan-out** — `Promise.allSettled` so one crashed specialist doesn't kill the pipeline; failures surfaced in PR comment
6. **Degraded judge fallback** — If judge JSON parsing fails after retry, specialist or deduped findings are published with an unverified banner; API/infrastructure failures still fail the action
7. **Single-file distribution** — `ncc` bundle makes the action self-contained with no runtime `npm install`
8. **Incremental review via persisted state** — `last_reviewed_sha` is stored per PR (via comment marker or GitHub Gist) to diff only new changes on `synchronize` events, preventing the infinite-findings loop

---

## Incremental Review (State Persistence)

To prevent the infinite-findings loop where the reviewer re-reviews already-seen code on every push, the action persists `last_reviewed_sha` per PR.

### How it works

```
Push 1 (PR opened):
  No previous state → full diff (base..head)
  After review → persist last_reviewed_sha = head_sha_1

Push 2 (synchronize):
  Read state → last_reviewed_sha = head_sha_1
  Incremental diff: head_sha_1..head_sha_2
  Only new/changed code sent to specialists
  After review → persist last_reviewed_sha = head_sha_2

Force-push (SHA unreachable):
  Read state → last_reviewed_sha = old_sha (gone)
  Detect unreachable commit → fall back to full diff
  After review → persist last_reviewed_sha = new_head_sha
```

### State store backends

| Backend | Config | How it works | Tradeoffs |
|---------|--------|--------------|-----------|
| **comment-marker** (default) | `state_store: comment-marker` | Embeds `<!-- ai-pr-reviewer-state: {...} -->` in the review comment | Zero config, no extra permissions, but tied to comment lifecycle |
| **gist** | `state_store: gist` + `state_gist_id: <id>` | Stores JSON files in a GitHub Gist, keyed by `repo-pr_number` | Durable, inspectable, requires a Gist + token with gist scope |
| **none** | `state_store: none` | No persistence, always full diff | Stateless but vulnerable to the review loop |

### Data flow with state

```
pull_request (synchronize)
  │
  ▼
Read state store → last_reviewed_sha
  │
  ├── SHA found + reachable → compare API: last_sha..head_sha (incremental)
  ├── SHA found + unreachable → full PR diff (force-push recovery)
  └── No state → full PR diff (first review)
  │
  ▼
Normal review pipeline (context → specialists → judge → output)
  │
  ▼
Write state store → last_reviewed_sha = head_sha
```

---

## Entry Points

| Layer | Path |
|-------|------|
| Source entry | `src/index.ts` → calls `main()` at module load |
| Compiled entry | `dist/index.js` (produced by `ncc build src/index.ts`) |
| Action entry | `action.yml` → `runs.main: dist/index.js` on Node 20 |

