# AI PR Reviewer — Architecture

A TypeScript GitHub Action that automates pull request code review using a multi-agent LLM pipeline. Runs on Node 24, bundled with `@vercel/ncc` into a single `dist/index.js`.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Specialist Agents | 3 implemented (`security`, `code`, `custom`); 2 enabled by default |
| Tool-Loop Specialists | 2 (`security`, `code`) — up to 3 hops each |
| Judge Stages | 1 (dedup) |
| Token Budget | ~75k tokens (~300k chars) of file sections per prompt |
| LLM Calls per PR | ≤1 judge (skipped when nothing to merge) + 1 per enabled specialist + tool-loop hops + 1 per caller subagent (capped at 5 per `find_references`, see below) |
| Allowed Files | 63 extensions + 14 exact filenames (JS, TS, Python, C/C++, Go, Rust, JVM, Ruby, PHP, IaC, etc.) |
| Ignore Patterns | 91 default globs |
| File-Specific Rules | 25 rule sets (risk weights + review hints) |

> **Note on categories:** `action.yml` still documents legacy `tests` and `performance` categories, and its `review_categories` default is `security,tests,performance,code`. Only `security`, `code`, and `custom` have implementations, so that default resolves to **`security` + `code`**; `loadConfig`'s own fallback (used by the CLI, where the action input is absent) is `security,code`. **`custom` is opt-in** — it only runs when you list it explicitly in `review_categories`. The `code` specialist covers correctness, error handling, and performance in a single pass.

> **Note on call volume:** caller subagents are dispatched with `Promise.all`, but capped at `MAX_CALLER_SUBAGENTS` (5) per `find_references` hit. Candidates are ranked by reference quality (semantic → syntactic → text-match) so the cap keeps the highest-signal callers; the remainder are recorded as `uncertain` ("not assessed — caller cap reached") without extra LLM calls. This hard-bounds the worst-case fan-out on large PRs.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions Runner                                │
│          pull_request → action.yml → dist/index.js (Node 24)                 │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
   ┌───────────┐           ┌──────────────┐          ┌──────────────┐
   │  Config   │           │  GitHub API  │          │ LLM Provider │
   │  Layer    │           │  REST Client │          │  (Anthropic  │
   │           │           │              │          │   OpenAI     │
   │ ┌───────┐ │           │ • PR metadata│          │   Azure)     │
   │ │ file  │ │           │ • Unified diff│         └──────────────┘
   │ │ rules │ │           │ • File list  │                 │
   │ ├───────┤ │           │ • File content│                │
   │ │prompts│ │           │ • Comments   │                 │
   │ ├───────┤ │           └──────┬───────┘                 │
   │ │ tools │ │                  │                         │
   │ ├───────┤ │                  ▼                         │
   │ │  app  │ │        ┌─────────────────┐                │
   │ └───────┘ │        │ Context Builder │                │
   └───────────┘        │                 │                │
                        │ • File filter   │                │
                        │ • Risk scoring  │                │
                        │ • Blast radius  │                │
                        │ • Token budget  │                │
                        │ • Secret redact │                │
                        └────────┬────────┘                │
                                 │                         │
          ┌──────────────────────┼──────────────────────┐  │
          ▼                      ▼                      ▼  ▼
      Security               Code                   Custom    ← Specialists
          │                      │                      │         (parallel)
          │  tool loop           │  tool loop           │  single-shot
          │  (read/search/refs)  │  (read/search/refs)  │
          └──────────────────────┼──────────────────────┘
                                 ▼
                        ┌────────────────┐
                        │  Judge: Dedup  │
                        │  (with retry)  │
                        └───────┬────────┘
                                ▼
                        ┌────────────────┐
                        │ Diff Anchoring │
                        │ (filter to     │
                        │  changed lines)│
                        └───────┬────────┘
                                ▼
                        ┌────────────────┐
                        │  Suppression   │
                        │ dismiss filter │
                        │ + state cache  │
                        └───────┬────────┘
                                ▼
                        ┌────────────────┐
                        │  Format MD     │
                        └───────┬────────┘
                                ▼
                 PR Summary Comment + Inline Comments
                        +  State Persistence
                        (SHA, findings, dismissals)
```

---

## Complete Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: INITIALIZATION                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  GitHub Action Trigger (pull_request: opened / synchronize)                  │
│       │                                                                      │
│       ▼                                                                      │
│  loadConfig()                                                                │
│       │  Reads: action inputs, env vars, default guidelines                  │
│       │  Outputs: ReviewConfig (provider, model, categories, patterns)       │
│       │                                                                      │
│       ▼                                                                      │
│  createProvider(config)                                                       │
│       │  Instantiates: AnthropicProvider | OpenAIProvider | AzureProvider     │
│       │                                                                      │
│       ▼                                                                      │
│  createStateStore(config)                                                     │
│       │  Backend: comment-marker | gist | none                               │
│       │  Reads: ReviewState for this PR                                      │
│       │    • lastReviewedSha, storedFindings, dismissedFingerprints          │
│       │                                                                      │
│       ▼                                                                      │
│  collectDismissedFingerprints()                                               │
│       │  /dismiss replies on inline threads + <!-- ai-pr-dismiss --> markers │
│       │  Merged with persisted dismissedFingerprints                         │
│       │                                                                      │
│       ▼                                                                      │
│  Same SHA already reviewed? (lastReviewedSha === headSha)                    │
│       YES → skip all LLM calls, then still fetch the PR and run              │
│             storedFindings through filterDismissedFindings +                 │
│             filterFindingsToDiff before refreshing comment + outputs         │
│       NO  → continue to data collection                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: DATA COLLECTION                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  getPullRequestData(token, options)                                           │
│       │                                                                      │
│       ├── pulls.get() → PR metadata (title, body, author, branches)          │
│       │                                                                      │
│       ├── Incremental check:                                                 │
│       │     last_reviewed_sha exists + reachable?                            │
│       │       YES → compareCommitsWithBasehead(old_sha...head_sha)           │
│       │       NO  → pulls.get(format: 'diff') [full PR diff]                │
│       │                                                                      │
│       ├── pulls.listFiles() → all changed file paths                         │
│       │                                                                      │
│       ├── partitionFiles(allFiles, ignorePatterns)                            │
│       │     isAllowedFile() then shouldIgnoreFile() via filter/              │
│       │     → { reviewedFiles, ignoredFiles, disallowedFiles }               │
│       │                                                                      │
│       ├── prepareDiffForReview(rawDiff, ignoredFiles)                         │
│       │     • filterDiffByFiles() → remove ignored file chunks               │
│       │     • redactSecrets() → strip API keys, tokens, passwords            │
│       │     • smartTruncateDiff() → cap at 300k chars at file boundaries     │
│       │                                                                      │
│       └── fetchFileContents(reviewedFiles)                                   │
│             • Concurrent fetch (max 10) of full files from HEAD ref          │
│             • Skip binary files (BINARY_EXTENSIONS check)                    │
│             • Truncate to MAX_FILE_SIZE (10k chars)                           │
│                                                                              │
│  Output: PullRequestData { diff, fileContents, reviewedFiles, metadata }     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: CONTEXT BUILDING                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  buildToolContext(pr, config) → ToolContext + ToolCache                      │
│       │  Built FIRST so blast-radius scoring below and the specialist tool   │
│       │  loops in Phase 4 all share one cache of reads/searches/refs.        │
│       ▼                                                                      │
│  buildSharedContextResult(pr, config, toolCtx.cache)                         │
│       │                                                                      │
│       ├── buildPrMetadata() → Title, author, branch, description             │
│       │                                                                      │
│       ├── buildReviewContext(diff, fileContents, budget)                      │
│       │     │                                                                │
│       │     ├── splitDiffByFile(diff) → per-file hunks                       │
│       │     │                                                                │
│       │     ├── scoreFile(path, hunk) → base risk score                      │
│       │     │                                                                │
│       │     ├── applyBlastRadiusScoring()                                    │
│       │     │     • Extract changed symbols from high-risk files             │
│       │     │     • findBlastRadiusCallers() via ts-morph / tree-sitter      │
│       │     │     • Boost effectiveScore +0.25 when callers found            │
│       │     │                                                                │
│       │     ├── Sort by effectiveScore (descending)                          │
│       │     │                                                                │
│       │     └── Allocate into char budget (highest score first):             │
│       │           score == 0.0            → skipped (lock/generated)         │
│       │           effectiveScore ≥ 0.6    → <diff> + <file> (full content)   │
│       │           effectiveScore < 0.6    → <diff> only                      │
│       │           budget exhausted        → excluded, whatever the score     │
│       │                                                                      │
│       └── buildFileSummary() → visual file list with risk indicators         │
│                                                                              │
│  Output: sharedContext string (file sections budgeted to ~75k tokens;        │
│          PR metadata + file summary are prepended on top of that)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: SPECIALIST AGENTS (Parallel)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Promise.allSettled([ specialist × N ])  — reusing toolCtx from Phase 3      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │ For each enabled category (security, code, custom):                  │     │
│  │                                                                      │     │
│  │  buildSpecialistSystemPrompt(categoryId, guidelines, config)         │     │
│  │  buildSpecialistUserPrompt(sharedContext, suppression?)              │     │
│  │    • suppression block lists dismissed + prior findings              │     │
│  │                                                                      │     │
│  │  security / code → runSpecialistToolLoop()                           │     │
│  │    • Up to MAX_TOOL_HOPS (3) rounds of tool requests                 │     │
│  │    • Tools: read_file, search_text, find_references                  │     │
│  │    • find_references with multiple hits → caller subagents           │     │
│  │    • Final hop returns action: "done" with findings JSON              │     │
│  │                                                                      │     │
│  │  custom → provider.review() single-shot                               │     │
│  │                                                                      │     │
│  │  sanitizeSpecialistFindings(findings, categoryId) — on every path    │     │
│  │    • Filter: invalid/missing severity → drop                         │     │
│  │    • Filter: missing message or file → drop                          │     │
│  │    • Filter: confidence "low" → drop (absent ⇒ "medium")             │     │
│  │    • Filter: vague phrasing (VAGUE_PATTERNS) → drop                  │     │
│  │    Tool loop calls it on the "done" payload; single-shot reaches it  │     │
│  │    via parseSpecialistFindings()                                     │     │
│  │                                                                      │     │
│  │  Output: SpecialistResult { categoryId, findings[], tokens, failed } │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  Error handling: crashed specialists → { failed: true, error }               │
│  Other specialists continue unaffected (allSettled)                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: JUDGE — DEDUPLICATION                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  collectSpecialistFindings(results) → merge all findings                     │
│       │                                                                      │
│       ▼                                                                      │
│  callWithParseRetry('judge/dedup', ...)                                      │
│       │                                                                      │
│       ├── buildJudgeDedupSystemPrompt(config)                                │
│       ├── buildJudgeDedupUserPrompt(allFindings)                             │
│       ├── provider.review() → LLM call                                       │
│       ├── Parse attempt 1 → parseDedupedFindings()                           │
│       ├── Parse attempt 2 (retry) on failure                                 │
│       └── Degraded fallback: buildUnverifiedFallback() + mechanical dedup    │
│                                                                              │
│  Output: StructuredReview { summary, findings[], unverified? }               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: POST-PROCESSING & OUTPUT                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  filterFindingsToDiff(structured, diff)                                      │
│       │  Only keep findings where file:line lands on a changed line          │
│       │  parseDiffForCommentTargets() → valid line map                       │
│       │                                                                      │
│       ▼                                                                      │
│  filterDismissedFindings(structured, dismissedFingerprints)                  │
│       │  Drop findings whose fingerprint was dismissed by reviewer             │
│       │                                                                      │
│       ▼                                                                      │
│  formatReviewMarkdown(opts)                                                  │
│       │  • Header: PR info, provider, mode                                   │
│       │  • Unverified banner (if judge failed)                               │
│       │  • Failed specialists warning                                        │
│       │  • Critical issues alert                                             │
│       │  • Findings by category + stats (tokens, cost, API calls)            │
│       │                                                                      │
│       ▼                                                                      │
│  postReviewComment(token, prNumber, markdown)                                │
│       │  Upsert by HTML marker; embed state when state_store=comment-marker  │
│       │                                                                      │
│       ▼                                                                      │
│  postInlineReview(token, prNumber, diff, findings)                           │
│       │  Map to valid diff lines; dedup against existing bot comments        │
│       │  Embed <!-- ai-pr-finding: fingerprint --> per comment               │
│       │                                                                      │
│       ▼                                                                      │
│  Persist ReviewState (gist or comment-marker) + set action outputs           │
│       │  { lastReviewedSha, storedFindings, dismissedFingerprints }          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
PR Review/
├── action.yml                    # GitHub Action metadata (inputs, outputs, entry point)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration (lint/build)
├── tsconfig.test.json            # Test compilation → dist-test/ (not cleaned between runs)
├── ARCHITECTURE.md               # This file
├── docs/
│   ├── agents.md                 # Agent pipeline + finding loop prevention
│   └── context.md                # Context pipeline
├── dist/
│   └── index.js                  # Bundled output (ncc build)
├── src/
│   ├── index.ts                  # Entry point — orchestrates full pipeline
│   │
│   ├── config/                   # Centralized configuration layer
│   │   ├── index.ts              # Barrel re-export
│   │   ├── app.ts                # loadConfig, ReviewConfig, severity rubric, JSON schemas
│   │   ├── file-rules/           # File-level allow/ignore/rules
│   │   │   ├── allowed-extensions.ts
│   │   │   ├── ignore-patterns.ts
│   │   │   ├── rules.ts          # Per-filetype review hints + risk weights
│   │   │   └── index.ts
│   │   ├── prompts/              # All prompt builders
│   │   │   ├── shared.ts         # buildSharedContext, buildPrMetadata, CATEGORY_LABELS
│   │   │   ├── specialist.ts     # Specialist system/user prompts + injection guards
│   │   │   ├── judge.ts          # Judge dedup prompts
│   │   │   ├── guidelines/       # Built-in review rules per category
│   │   │   │   ├── security.ts
│   │   │   │   ├── performance.ts  # Used as default `code` guidelines
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   └── tools/                # On-demand tool definitions
│   │       ├── definitions.ts    # TOOL_INSTRUCTIONS, TOOL_CATEGORIES, MAX_TOOL_HOPS
│   │       └── index.ts
│   │
│   ├── filter/                   # File filtering (glob matching, binary detection)
│   │   ├── file-filter.ts
│   │   └── index.ts
│   │
│   ├── context/
│   │   ├── index.ts              # Barrel export
│   │   ├── diff/                 # Diff parsing, scoring, context assembly
│   │   │   ├── loader.ts         # splitDiffByFile, prepareDiffForReview, comment targets
│   │   │   ├── scorer.ts         # scoreFile, RISK_PATH_PATTERNS, THRESHOLDS
│   │   │   ├── builder.ts        # buildReviewContext, buildFileSummary
│   │   │   ├── blast-radius.ts   # applyBlastRadiusScoring
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   └── on-demand/            # Specialist tool loop + reference analysis
│   │       ├── tools.ts          # read_file, search_text, find_references, ToolCache
│   │       ├── tool-loop.ts      # Multi-hop tool loop + caller subagents
│   │       ├── tree-sitter-loader.ts  # Lazy, fail-soft native parser loading
│   │       └── index.ts
│   │
│   ├── agents/
│   │   ├── index.ts              # Public API (re-exports runReview)
│   │   ├── orchestrator.ts       # Fan-out → judge → diff filter → format
│   │   ├── specialist.ts         # Specialist runner (tool loop or single-shot)
│   │   ├── judge.ts              # Dedup with parse retry + unverified fallback
│   │   └── types.ts              # SpecialistResult, ReviewResult, TokenUsage
│   │
│   ├── output/
│   │   ├── findings.ts           # Finding types, JSON parsing, validation, dedup
│   │   ├── format.ts             # PR comment markdown rendering
│   │   ├── debug.ts              # Tool-loop debug recorder (hops, tools, verdicts)
│   │   └── index.ts
│   │
│   ├── providers/                # LLM provider implementations
│   │   ├── index.ts              # createProvider factory
│   │   ├── types.ts              # AIProvider interface
│   │   ├── anthropic.ts          # Claude API (prompt caching via cache_control)
│   │   ├── openai.ts             # OpenAI Chat Completions (json_object mode)
│   │   └── azure.ts              # Azure OpenAI (deployment URL parsing)
│   │
│   ├── github/
│   │   ├── index.ts
│   │   ├── client.ts             # Octokit factory
│   │   ├── types.ts              # PullRequestData, FetchPROptions
│   │   ├── pr-data.ts            # Fetch PR metadata, diff, changed files
│   │   ├── file-contents.ts      # Fetch full file contents from head branch
│   │   ├── comments.ts           # Upsert summary comment, post inline comments
│   │   └── dismissals.ts         # Parse /dismiss replies and dismiss markers
│   │
│   ├── state/
│   │   ├── index.ts
│   │   ├── store.ts              # GistStateStore, comment-marker, factory
│   │   ├── findings-state.ts     # StoredFinding serialization
│   │   └── suppression.ts        # Suppression prompt + dismiss merge helpers
│   │
│   ├── history/                  # Optional append-only run/finding log
│   │   ├── index.ts              # createHistoryStore factory (null when unset)
│   │   ├── supabase.ts           # PostgREST client over native fetch
│   │   ├── record.ts             # Pipeline output → row mapping
│   │   ├── types.ts              # RunRecord, FindingRecord, HistoryStore
│   │   └── schema.sql            # DDL: tables, indexes, RLS
│   │
│   ├── cli/
│   │   └── local-review.ts       # CLI for local testing
│   │
│   ├── redact.ts                 # Secret redaction before LLM calls
│   ├── sanitize.ts               # Error sanitization in logs
│   ├── retry.ts                  # Retry + timeout wrapper for LLM API calls
│   ├── cost.ts                   # Approximate token cost estimation
│   │
│   └── __tests__/                # Node.js built-in test runner tests
│
└── .github/
    └── workflows/
        └── ci.yml                # CI: lint, test, build
```

---

## Config Layer (`src/config/`)

### `app.ts`

Resolves action inputs → env vars → defaults into `ReviewConfig`. Defines token budgets, timeouts, severity rubric, and JSON output schemas shared by specialists and judge.

Implemented categories:

| Category | Default Guidelines | Tool Loop | Enabled by default |
|----------|-------------------|-----------|--------------------|
| `security` | `prompts/guidelines/security.ts` | Yes | Yes |
| `code` | `prompts/guidelines/performance.ts` (covers correctness + perf) | Yes | Yes |
| `custom` | User `repo_context` input | No (single-shot) | No — list `custom` in `review_categories` |

### `file-rules/allowed-extensions.ts`

Controls **which files enter the review pipeline** at all — enforced by `partitionFiles()` in [src/github/pr-data.ts](src/github/pr-data.ts) and by `isSearchableFile()` for on-demand tool access. Allowlists 63 extensions plus 14 exact filenames (`Dockerfile`, `Makefile`, `Gemfile`, `go.mod`, `CODEOWNERS`, `.env.example`, etc.).

Adding a file type to `FILE_RULES` or to the scorer's path patterns is not enough on its own: a type missing from this allowlist is dropped before scoring runs. Files rejected here are logged separately from ignore-pattern matches so the gap is visible in Action logs.

### `file-rules/ignore-patterns.ts`

Files that are **never reviewed** regardless of extension: `node_modules/`, lock files, build outputs, `.env`, generated code, binaries, CI/docs paths, etc.

### `file-rules/rules.ts`

Per-filetype **review hints and risk weights** for 25 file types (package manifests, C/C++, Python, Terraform, shell, SQL, etc.). Exported via `getFileRules()`, `getFileRiskWeight()`, and `getFileReviewHints()`. `scoreFile()` in `context/diff/scorer.ts` multiplies its path-pattern score by `getFileRiskWeight()`, so high-blast-radius types (C/C++ 1.5, Terraform 1.4, shell/SQL 1.3) get boosted scrutiny and low-risk types (stylesheets 0.4, data configs 0.7) are dampened. `getFileReviewHints()` remains available for future prompt injection.

### `prompts/`

All LLM prompt construction lives here, separated from agent orchestration:

- **shared.ts** — `buildSharedContextResult()` (and the `buildSharedContext()` string-only wrapper), `buildPrMetadata()`, `CATEGORY_LABELS`
- **specialist.ts** — Role definitions, injection guards, HOW TO REVIEW steps
- **judge.ts** — Three-condition duplicate rule, merge semantics

### `tools/definitions.ts`

Defines the on-demand tool protocol appended to security/code specialist system prompts:

| Tool | Purpose |
|------|---------|
| `read_file` | Fetch a file not included in the shared context |
| `search_text` | Regex/literal search across reviewable files |
| `find_references` | Semantic (ts-morph), syntactic (tree-sitter), or text-match reference lookup |

`TOOL_CATEGORIES = { security, code }`. `MAX_TOOL_HOPS = 3`.

---

## On-Demand Context Tools (`src/context/on-demand/`)

Security and code specialists can request additional context before returning findings. This replaces a single monolithic prompt with a multi-hop loop:

```
Specialist prompt + shared context
        │
        ▼
   ┌─────────┐     action: "tool"      ┌──────────────┐
   │ LLM hop │ ──────────────────────► │ executeTool  │
   └─────────┘                         │ read/search/ │
        ▲                              │ find_refs    │
        │     tool results appended    └──────┬───────┘
        │                                     │
        │         multiple ref hits?          ▼
        │                              ┌──────────────┐
        │                              │ Caller       │
        │                              │ subagents    │
        │                              │ (parallel)   │
        │                              └──────────────┘
        │
        ▼
   action: "done" → findings JSON
```

### Reference analysis (`tools.ts`)

| Language | Engine | Reference source |
|----------|--------|-----------------|
| TypeScript / JavaScript | `ts-morph` | `semantic` |
| Python | `tree-sitter-python` | `syntactic` |
| Go | `tree-sitter-go` | `syntactic` |
| Other | Regex scan | `text-match` |

These are best-effort, not guarantees. `tree-sitter` is a native module loaded lazily on first use by `tree-sitter-loader.ts`; if the `require` fails on the runner — a real possibility for an `ncc`-bundled action — it logs a warning, marks itself unavailable, and Python/Go fall back to `text-match`. `ts-morph` failures degrade the same way. Check the Action log for the warning before trusting a `syntactic` or `semantic` result.

`ToolCache` deduplicates file reads, searches, and reference lookups within a single PR review run. The same cache is shared across specialists and the blast-radius scoring pass.

### Caller subagents (`tool-loop.ts`)

When `find_references` returns multiple candidates, parallel subagent calls assess each caller site independently:

```json
{ "breaks": "yes" | "no" | "uncertain", "why": "one-line reason" }
```

Verdicts are appended to the next tool-loop hop so the specialist can decide whether an API/signature change is breaking.

---

## Context Building Strategy

```
                      File Arrives
                          │
                          ▼
                 ┌─────────────────┐
                 │ isAllowedFile() │ ← config/file-rules/allowed-extensions.ts
                 └────────┬────────┘
                          │ not on allowlist → skip
                          ▼
                 ┌─────────────────┐
                 │shouldIgnoreFile()│ ← filter/file-filter.ts
                 └────────┬────────┘
                          │ ignored → skip
                          ▼
                 ┌─────────────────┐
                 │  isBinaryFile() │
                 └────────┬────────┘
                          │ binary → skip content fetch
                          ▼
                 ┌─────────────────┐
                 │   scoreFile()   │ ← context/diff/scorer.ts
                 └────────┬────────┘
                          │ score == 0.0 (lock/generated) → skip
                          ▼
                 ┌─────────────────┐
                 │ Blast radius    │ ← context/diff/blast-radius.ts
                 │ scoring boost   │
                 └────────┬────────┘
                          │
                          ▼
                 Sort by effectiveScore, then fill the char budget
                          │
      ┌───────────────────┼───────────────────┐
      ▼                   ▼                   ▼
   HIGH RISK          BELOW 0.6           BUDGET GONE
   (≥ 0.6)                                (any score)
      │                   │                   │
  <diff> + <file>      <diff> only          Excluded
  + caller refs
```

The first two gates run in `partitionFiles()` ([src/github/pr-data.ts](src/github/pr-data.ts)); files rejected by either are also stripped from the diff. `isBinaryFile()` gates the full-content fetch. `isSearchableFile()` applies the same three checks in the same order for on-demand tool access.

Score is a **ranking** signal, not an inclusion threshold. Only `score == 0.0` (lock files, generated output, build dirs) is hard-skipped. Everything else is sorted by `effectiveScore` and included until the char budget runs out, so a low-scored file still gets diff-only context on a small PR. `THRESHOLDS.HIGH_RISK` (0.6) is the only threshold that gates behavior: it decides whether full file content accompanies the diff.

### Risk scoring factors (`scorer.ts`)

Base score comes from the **highest-scoring** matching path pattern (not the first match). A file matching no pattern starts at **0.4**.

| Path pattern | Base score |
|--------------|-----------|
| Auth/payment/secret paths | 0.95 |
| Admin/internal paths | 0.85 |
| Migration/schema paths | 0.80 |
| Config/settings paths | 0.75 |
| Middleware/util/shared paths | 0.75 |
| Router/controller/handler/service/repository paths | 0.60 |
| `index.*` entry points | 0.55 |
| No pattern matched | 0.40 |
| `.env.example` | 0.35 |
| Markdown/README/CHANGELOG/LICENSE/`docs/` | 0.05 |
| Lock files, `dist/`, `build/` | 0.00 — hard-skipped |

Adjustments, applied in this order:

| Factor | Score Impact |
|--------|-------------|
| 300+ changed lines | +0.15 |
| 100+ changed lines | +0.10 |
| 50+ changed lines | +0.05 |
| Delete-only changes | −0.10 |
| New file bonus | +0.15 |
| New file that matched **no** pattern | floored up to 0.6 so unfamiliar code gets full content |
| Test files | short-circuit to a flat 0.2, ignoring everything above (risk weight not applied) |
| Per-filetype risk weight | `score × getFileRiskWeight(path)` (0.4–1.5), applied last, capped at 1.0 — a 0.00 hard-skip stays skipped |
| Blast-radius callers found | `effectiveScore = max(score + 0.25, 0.45)`, capped at 1.0 |

Blast radius only ever raises a score, and only for non-deleted files already below 0.6. It searches the **high-risk** files for callers of the symbols changed in the file being scored, so a low-risk file that high-risk code depends on gets promoted along with up to 3 caller references.

---

## Module Reference

| Module | Path | Responsibility |
|--------|------|----------------|
| **Entry** | `src/index.ts` | Top-level pipeline: config → fetch PR → review → post comments |
| **Config/App** | `src/config/app.ts` | Resolves inputs, env vars, defaults; JSON schema + severity rubric |
| **Config/File Rules** | `src/config/file-rules/` | Allowed extensions, ignore patterns, per-filetype hints |
| **Config/Prompts** | `src/config/prompts/` | All system/user prompt builders with injection guards |
| **Config/Tools** | `src/config/tools/` | Tool-loop protocol definitions |
| **Filter** | `src/filter/file-filter.ts` | Glob matching, binary detection, diff filtering |
| **Context/Diff** | `src/context/diff/` | Diff parsing, risk scoring, blast radius, budget allocation |
| **Context/On-Demand** | `src/context/on-demand/` | Tool loop, reference analysis, caller subagents |
| **Orchestrator** | `src/agents/orchestrator.ts` | Fan-out → judge → diff filter → format |
| **Specialist** | `src/agents/specialist.ts` | Tool-loop or single-shot LLM call per category |
| **Judge** | `src/agents/judge.ts` | Deduplicate findings with parse retry + fallback |
| **Findings** | `src/output/findings.ts` | Structured finding model; parsing, filtering, dedup |
| **Format** | `src/output/format.ts` | Renders final PR markdown |
| **PR Data** | `src/github/pr-data.ts` | Fetches PR metadata, diff, changed files |
| **File Contents** | `src/github/file-contents.ts` | Fetches full file contents (concurrent, max 10) |
| **Comments** | `src/github/comments.ts` | Upserts summary comment; posts inline review comments |
| **Providers** | `src/providers/` | Uniform `AIProvider` over Anthropic, OpenAI, Azure |
| **Redact** | `src/redact.ts` | Secret redaction before sending to LLMs |
| **Sanitize** | `src/sanitize.ts` | Strips API keys from failure messages in logs |
| **Retry** | `src/retry.ts` | Exponential backoff on 429/5xx/timeouts |
| **Cost** | `src/cost.ts` | Approximate token cost estimation for review footer |
| **State** | `src/state/` | Persists `lastReviewedSha`, `storedFindings`, `dismissedFingerprints` |
| **Dismissals** | `src/github/dismissals.ts` | Collects `/dismiss` replies and `ai-pr-dismiss` markers from PR |
| **Suppression** | `src/state/suppression.ts` | Injects prior/dismissed findings into specialist prompts |

---

## Multi-Agent Topology

### Specialists (Stage 1 — Parallel)

Up to 3 specialist agents run concurrently via `Promise.allSettled` — 2 of them by default:

| Specialist | Focus | Mode | Default |
|------------|-------|------|---------|
| **Security** | Injection, XSS, secrets, auth gaps, crypto misuse | Tool loop | On |
| **Code** | Correctness, error handling, performance, race conditions | Tool loop | On |
| **Custom** | User-defined guidelines from `repo_context` | Single-shot | Off — add `custom` to `review_categories` |

Each specialist receives:
- A **system prompt** with: injection guard → role → HOW TO REVIEW → guidelines → JSON schema → review policy
- A **user prompt** with: PR metadata → file summary → risk-scored diff/file sections → review instruction

Security and code specialists are instructed to call `find_references` before flagging signature/API changes.

### Judge (Stage 2)

A single LLM call consolidates specialist output:

0. **Skip gate** — When there are ≤1 findings, or no two findings share a file, there is nothing to merge; `runJudge` returns a mechanically-deduped review with **no LLM call** (`apiCalls: 0`)
1. **Dedup** — Three-condition duplicate rule (same function + same guard + same failure mode)
2. **Parse retry** — If JSON parsing fails, retry once with the same prompt
3. **Degraded fallback** — Mechanical dedup by category+file+line with an unverified banner

---

## Security Controls

| Control | Description |
|---------|-------------|
| **Secret Redaction** | Secrets stripped from diffs and file contents before LLM calls (`redact.ts`) |
| **Injection Guards** | Untrusted PR content wrapped in `<pr_description>`, `<diff>`, `<file>` delimiters |
| **Error Sanitization** | API keys stripped from failure messages in logs (`sanitize.ts`) |
| **Degraded Judge Fallback** | Unparseable judge output → specialist findings published with unverified banner |
| **Diff-Anchored Findings** | Only findings with `file:line` on a changed line survive post-processing — applied on both the fresh and the cached same-SHA path. Findings with no `file` or no numeric `line` are kept rather than dropped |
| **Finding Suppression** | Dismissed fingerprints filtered mechanically; prior findings injected into prompts |
| **Same-Commit Reuse** | Re-running on an already-reviewed SHA skips LLM and reuses `storedFindings` |
| **Vague Finding Filter** | Findings matching `VAGUE_PATTERNS` ("Ensure/Consider/Verify that/Make sure…") are auto-dropped on every specialist path |
| **Low Confidence Filter** | Findings with `confidence: "low"` are auto-dropped; a missing confidence defaults to `"medium"` |
| **File Filtering Pipeline** | Three-layer gate: allowed extensions → ignore patterns → binary detection. The first two run in `partitionFiles()`, so rejected files are dropped from the diff too |

---

## Finding Lifecycle

```
File arrives in PR
  → isAllowedFile()? → shouldIgnoreFile()? → isBinaryFile()?
    → Risk-scored + blast-radius boosted → budgeted into shared context
      → Load ReviewState + dismissed fingerprints from PR comments
        → Same SHA already reviewed? → reuse cached findings (skip LLM),
          still applying filterDismissedFindings + filterFindingsToDiff
          → Specialist raw JSON (or tool-loop multi-hop)
            → suppression prompt: do not re-report dismissed / likely-fixed issues
              → sanitizeSpecialistFindings(): drop vague, low-confidence,
                or malformed findings (missing severity / message / file)
                → Judge dedup: three-condition rule, merge duplicates
                  → Parse retry on failure → degraded mechanical dedup
                    → filterFindingsToDiff(): only diff-touching lines survive
                      → filterDismissedFindings(): drop reviewer-dismissed ids
                        → Final StructuredReview
                          → Posted as summary comment + inline comments (with fingerprints)
                            → State persisted: lastReviewedSha, storedFindings, dismissedFingerprints
```

See [docs/agents.md](docs/agents.md) for the full agent pipeline and dismissal UX.

---

## Incremental Review & Finding Loop Prevention

### Incremental diff

```
Push 1 (PR opened):
  No previous state → full diff (base..head)
  After review → persist lastReviewedSha = head_sha_1 + storedFindings

Push 2 (synchronize):
  Read state → lastReviewedSha = head_sha_1
  Incremental diff: head_sha_1..head_sha_2
  Suppression prompt includes findings from push 1
  After review → persist lastReviewedSha = head_sha_2

Workflow re-run (same commit, no new push):
  lastReviewedSha === headSha → reuse storedFindings, skip LLM

Force-push (SHA unreachable):
  Fall back to full diff, persist new head SHA
```

### Dismissing findings

Inline comments include `<!-- ai-pr-finding: category|file|message-headline -->`. Reviewers reply `/dismiss` (or `dismiss`, `won't fix`, `ignore`) on the thread to suppress that finding on future runs. Alternatively, post `<!-- ai-pr-dismiss: fingerprint -->` as a PR issue comment.

### State schema

```ts
interface ReviewState {
  lastReviewedSha: string;
  lastReviewedAt: string;
  reviewCount: number;
  storedFindings?: StoredFinding[];
  dismissedFingerprints?: string[];
}
```

| Backend | Config | How it works |
|---------|--------|--------------|
| **comment-marker** (default) | `state_store: comment-marker` | `<!-- ai-pr-reviewer-state: {...} -->` embedded in review comment |
| **gist** | `state_store: gist` + `state_gist_id` | One JSON file per PR in a GitHub Gist, named `ai-pr-reviewer-state-<owner>-<repo>-<pr_number>.json` (slashes in the repo path become `-`). Needs a token with `gist` scope |
| **none** | `state_store: none` | No persistence; always full diff; no same-commit reuse or dismiss persistence |

Requires `incremental_review: true` (default). Consumer workflows should use **concurrency** (`cancel-in-progress: true`) so `lastReviewedSha` does not race between parallel runs.

---

## Run History (`src/history/`)

Optional append-only log of every run and every finding, kept **separate from the state store**. The state store holds one mutable snapshot per PR (what the next run needs to know); the history store holds an immutable row per run (what happened over time). Opt in by setting both `supabase_url` and `supabase_key`; unset means the module is never constructed.

| Table | One row per | Purpose |
|-------|-------------|---------|
| `pr_review_runs` | workflow run | Cost, latency, token, and outcome trend per PR |
| `pr_review_findings` | surviving finding | Bug log, queryable by severity, file, or fingerprint |

Apply `src/history/schema.sql` before enabling. Design points:

1. **Best-effort by contract.** `SupabaseHistoryStore.record()` catches its own errors and resolves `null` rather than throwing, so a database outage degrades telemetry instead of failing the PR check. Recording happens *after* the comment is posted and state is persisted, so it can never delay feedback to the developer.
2. **Client-generated UUIDs.** The run id comes from `crypto.randomUUID()`, so findings can carry `run_id` without a second round trip to read back a serial id. Inserts use `Prefer: return=minimal`.
3. **No new dependencies.** Writes go over PostgREST (`POST /rest/v1/<table>`) with the native `fetch`, keeping the `ncc` bundle unchanged. `FetchLike` is injectable for tests.
4. **Tight budget.** 2 attempts, 10s timeout (vs. 3 / 120s for LLM calls) — telemetry must not slow the check. Findings insert in chunks of 500.
5. **Denormalized findings.** `repo`, `pr_number`, and `head_sha` are copied onto each finding row so the common "all criticals in this repo" query needs no join. Safe because rows are never updated.
6. **Every run recorded, tagged by kind.** Cached same-SHA replays (`cached: true`) and no-op pushes (zero findings, zero tokens) are recorded too, so gaps in the history mean a genuine failure. Filter on `cached = false` for cost analysis.

Auth uses a **secret** key (`sb_secret_...`, or the legacy `service_role` key, deprecated by Supabase at end of 2026), which bypasses RLS. `schema.sql` enables RLS with no permissive policy, so publishable/anon keys cannot read review history through the public API. Both key formats are redacted by `sanitizeErrorMessage()`.

Writes are recorded in both same-SHA and fresh paths, plus the "no new changes" early return. The run id is exposed as the `history_run_id` action output (empty when disabled or when the write failed).

---

## External Integrations

### GitHub REST API (via `@actions/github`)

| Operation | Purpose |
|-----------|---------|
| `pulls.get` | PR metadata + unified diff |
| `pulls.listFiles` | Changed file list |
| `repos.compareCommitsWithBasehead` | Incremental diff between SHAs |
| `repos.getContent` | Full file contents at PR head ref |
| `git.getCommit` | Verify SHA reachability (force-push detection) |
| `issues.listComments` / `createComment` / `updateComment` | Summary review comment (upsert), dismiss markers |
| `pulls.listReviewComments` | Inline comments; `/dismiss` reply detection |
| `pulls.createReview` / `createReviewComment` | Post inline diff comments with finding fingerprints |
| `gists.get` / `gists.update` | State persistence (gist backend) |

**Permissions required:** `contents: read`, `pull-requests: write`

The default `${{ github.token }}` covers every operation above **except the gist backend**. `gists.get` / `gists.update` are not governed by workflow `permissions`, so `state_store: gist` needs a PAT with the `gist` scope passed as `github_token`. The default `comment-marker` backend needs no extra scope.

### LLM Providers

| Provider | SDK | Notes |
|----------|-----|-------|
| **Anthropic** | `@anthropic-ai/sdk` | `messages.create`, temp=0, `cache_control` blocks. Specialist tool-loop, single-shot, judge, and caller-subagent calls all pass the stable system prompt as an ephemeral-cache block, so repeated hops/retries/parallel subagents reuse the cached prefix instead of re-billing it |
| **OpenAI** | `openai` | Chat Completions, `response_format: json_object` |
| **Azure OpenAI** | `openai` (`AzureOpenAI`) | Parses endpoint URL, deployment name as model |

### Supabase (optional)

| Operation | Purpose |
|-----------|---------|
| `POST /rest/v1/pr_review_runs` | One run row per workflow run |
| `POST /rest/v1/pr_review_findings` | One row per surviving finding, chunked at 500 |

Plain PostgREST over native `fetch` — no SDK, no bundle-size cost. Failures are logged and swallowed.

All providers go through `withRetry()` — 3 attempts, exponential backoff, 120s timeout per call.

---

## Key Design Decisions

1. **Multi-agent over monolith** — Parallel domain experts plus a judge for quality control
2. **Consolidated code specialist** — Correctness and performance reviewed together to reduce redundant LLM calls
3. **On-demand tools** — Security/code specialists fetch references and extra files only when needed
4. **Blast-radius scoring** — Caller context included for files that depend on high-risk changes
5. **Three-layer file filtering** — Allowed extensions → ignore patterns → binary detection
6. **Context over diff-only** — Full file contents for high-risk files so reviewers see complete functions/APIs
7. **Budget-aware context** — Risk score is a ranking signal, not a cutoff: files are sorted by score and packed into the char budget, so small PRs get broad coverage and large PRs degrade to the riskiest files first
8. **Quality gates at multiple layers** — Injection guards, specialist filters, judge dedup, diff-anchoring. Every specialist path funnels through one `sanitizeSpecialistFindings()` so the filters cannot be bypassed by adding a new specialist mode
9. **Resilient fan-out** — `Promise.allSettled` so one crashed specialist doesn't kill the pipeline
10. **Judge parse retry + fallback** — One retry on parse failure; then mechanical dedup with unverified banner
11. **Single-file distribution** — `ncc` bundle makes the action self-contained
12. **Incremental review via persisted state** — `lastReviewedSha` prevents re-reviewing unchanged code
13. **Finding loop prevention** — Same-commit reuse, `/dismiss` on inline threads, suppression prompts, and mechanical dismiss filter so fixed or ignored issues do not block merges indefinitely

---

## Entry Points

| Layer | Path |
|-------|------|
| Source entry | `src/index.ts` → calls `main()` at module load |
| Compiled entry | `dist/index.js` (produced by `ncc build src/index.ts`) |
| Action entry | `action.yml` → `runs.main: dist/index.js` on Node 24 |
| CLI entry | `src/cli/local-review.ts` → `npm run local-review` |

## Related docs

| Doc | Contents |
|-----|----------|
| [docs/modules.md](docs/modules.md) | Compact module map, call graph, cost-sensitive hotspots |
| [docs/agents.md](docs/agents.md) | Specialist → judge pipeline, the mechanical evidence checks around it, finding loop prevention |
| [docs/context.md](docs/context.md) | PR → diff → context builder → on-demand tools |
| [README.md](README.md) | Quick start, inputs/outputs, consumer workflow setup |

---

## Dependencies

### Runtime
- `@actions/core` — Logging, inputs/outputs, failure signaling
- `@actions/github` — GitHub context + Octokit client
- `@anthropic-ai/sdk` — Claude API (with prompt caching)
- `openai` — OpenAI Chat Completions + Azure OpenAI
- `tree-sitter` / `tree-sitter-python` / `tree-sitter-go` — Syntactic reference analysis (lazily loaded, optional)
- `ts-morph` — Semantic reference analysis for TypeScript/JavaScript
- `yaml` — YAML parsing

### Dev
- `typescript` — Strict TS compilation; `npm run lint` is `tsc --noEmit` (no ESLint in this repo)
- `@vercel/ncc` — Bundles into single `dist/index.js`
- `@types/node` — Node 22 types (`^22.10.0`), while the action itself runs on Node 24
