# AI PR Reviewer — Architecture

A TypeScript GitHub Action that automates pull request code review using a multi-agent LLM pipeline. Runs on Node 20, bundled with `@vercel/ncc` into a single `dist/index.js`.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Specialist Agents | 5 (security, tests, performance, code, custom) |
| Judge Stages | 1 (dedup) |
| Token Budget | ~75k tokens (~300k chars) |
| Max Findings | 8 per review |
| LLM Calls per PR | up to 6 (5 specialists + 1 judge) |
| Allowed Extensions | 50+ (JS, TS, Python, C/C++, Go, Rust, Java, Ruby, PHP, etc.) |
| Ignore Patterns | 90+ default globs |
| File-Specific Rules | 25 rule sets with risk weights |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions Runner                                │
│          pull_request → action.yml → dist/index.js (Node 20)                 │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
   ┌───────────┐           ┌──────────────┐          ┌──────────────┐
   │  Config   │           │  GitHub API  │          │ LLM Provider │
   │  Layer    │           │  REST Client │          │  (Anthropic  │
   │           │           │              │          │   OpenAI     │
   │ ┌───────┐ │           │ • PR metadata│          │   Azure)     │
   │ │allowed│ │           │ • Unified diff│         └──────────────┘
   │ │ exts  │ │           │ • File list  │                 │
   │ ├───────┤ │           │ • File content│                │
   │ │ignore │ │           │ • Comments   │                 │
   │ │pattern│ │           └──────┬───────┘                 │
   │ ├───────┤ │                  │                         │
   │ │ file  │ │                  ▼                         │
   │ │ rules │ │        ┌─────────────────┐                │
   │ ├───────┤ │        │ Context Builder │                │
   │ │  app  │ │        │                 │                │
   │ │config │ │        │ • File filter   │                │
   │ └───────┘ │        │ • Risk scoring  │                │
   └───────────┘        │ • Token budget  │                │
                        │ • Secret redact │                │
                        └────────┬────────┘                │
                                 │                         │
          ┌──────────┬───────────┼───────────┬─────────────┤
          ▼          ▼           ▼           ▼             ▼
      Security    Tests       Perf        Code          Custom    ← Specialists
          │          │           │           │             │         (parallel)
          └──────────┴───────────┼───────────┴─────────────┘
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
                        │  Format MD     │
                        └───────┬────────┘
                                ▼
                 PR Summary Comment + Inline Comments
                        +  State Persistence
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
│       │  Reads: last_reviewed_sha for this PR                                │
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
│       │     ┌─────────────────────────────────────────────┐                  │
│       │     │ For each file:                              │                  │
│       │     │   shouldIgnoreFile(file, patterns)?         │                  │
│       │     │     YES → ignoredFiles[]                    │                  │
│       │     │     NO  → reviewedFiles[]                   │                  │
│       │     └─────────────────────────────────────────────┘                  │
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
│  buildSharedContext(pr, config, prioritizeTests?)                             │
│       │                                                                      │
│       ├── buildPrMetadata() → Title, author, branch, description             │
│       │                                                                      │
│       ├── buildReviewContext(diff, fileContents, budget)                      │
│       │     │                                                                │
│       │     ├── splitDiffByFile(diff) → per-file hunks                       │
│       │     │                                                                │
│       │     ├── For each file: scoreFile(path, hunk, options)                │
│       │     │     ┌─────────────────────────────────────────┐                │
│       │     │     │ Risk Scoring Algorithm:                  │                │
│       │     │     │                                          │                │
│       │     │     │ 1. Test file? → fixed score (0.2 or 0.8)│                │
│       │     │     │ 2. Match RISK_PATH_PATTERNS (auth=0.95,  │                │
│       │     │     │    payment=0.95, migration=0.80, etc.)   │                │
│       │     │     │ 3. No pattern? → baseline 0.4            │                │
│       │     │     │ 4. +lines changed bonus (50→+0.05,       │                │
│       │     │     │    100→+0.10, 300→+0.15)                │                │
│       │     │     │ 5. Delete-only penalty: -0.10            │                │
│       │     │     │ 6. New file boost: +0.15                 │                │
│       │     │     │ 7. File rule risk weight (from config)   │                │
│       │     │     └─────────────────────────────────────────┘                │
│       │     │                                                                │
│       │     ├── Sort by score (descending)                                   │
│       │     │                                                                │
│       │     └── Allocate into budget:                                        │
│       │           score ≥ 0.6 → <diff> + <file> (full content)              │
│       │           score ≥ 0.3 → <diff> only                                 │
│       │           score < 0.3 → excluded                                     │
│       │           budget full → fallback to diff-only or skip                │
│       │                                                                      │
│       └── buildFileSummary() → visual file list with risk indicators         │
│                                                                              │
│  Output: sharedContext string (≤ 75k tokens)                                 │
│  Output: testSharedContext string (test files boosted)                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: SPECIALIST AGENTS (Parallel)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Promise.allSettled([ specialist × N ])                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │ For each enabled category (security, tests, performance, code, custom):│  │
│  │                                                                      │     │
│  │  buildSpecialistSystemPrompt(categoryId, guidelines, config)         │     │
│  │    • Injection guard prefix                                          │     │
│  │    • Role definition (domain-specific identity)                      │     │
│  │    • HOW TO REVIEW instructions (4-step process)                     │     │
│  │    • Category-specific guidelines                                    │     │
│  │    • JSON output schema + severity rubric                            │     │
│  │    • Review policy (if configured)                                   │     │
│  │                                                                      │     │
│  │  buildSpecialistUserPrompt(sharedContext)                            │     │
│  │    • PR metadata + risk-scored context                               │     │
│  │    • Step-by-step review instructions                                │     │
│  │                                                                      │     │
│  │  provider.review({ systemPrompt, userPrompt, timeout: 120s })        │     │
│  │       │                                                              │     │
│  │       ▼                                                              │     │
│  │  parseSpecialistFindings(response, categoryId)                       │     │
│  │    • extractJson() → parse JSON from response                        │     │
│  │    • Validate severity, confidence, file, message                    │     │
│  │    • Filter: low confidence → drop                                   │     │
│  │    • Filter: vague phrasing (Ensure/Consider/Verify) → drop          │     │
│  │    • Filter: missing file path → drop                                │     │
│  │    • Inject category ID into each finding                            │     │
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
│       │     • Injection guard                                                │
│       │     • Three-condition duplicate rule:                                │
│       │       1. Same named function/variable                                │
│       │       2. Same missing guard/check/behavior                           │
│       │       3. Same failure mode in production                             │
│       │     • Merge rules: keep highest severity + best snippet              │
│       │     • JSON output schema                                             │
│       │                                                                      │
│       ├── buildJudgeDedupUserPrompt(allFindings)                             │
│       │     • Full JSON of all specialist findings                           │
│       │                                                                      │
│       ├── provider.review() → LLM call                                       │
│       │                                                                      │
│       ├── Parse attempt 1:                                                   │
│       │     parseDedupedFindings(response) → Finding[]                       │
│       │     SUCCESS? → return findings                                       │
│       │     FAIL? → retry once ↓                                             │
│       │                                                                      │
│       ├── Parse attempt 2 (retry):                                           │
│       │     Same prompt → parse again                                        │
│       │     SUCCESS? → return findings                                       │
│       │     FAIL? → degraded fallback ↓                                      │
│       │                                                                      │
│       └── Degraded fallback:                                                 │
│             buildUnverifiedFallback(findings)                                │
│               • mechanicalDedup() by category+file+line                      │
│               • Mark as unverified                                           │
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
│  formatReviewMarkdown(opts)                                                  │
│       │  • Header: PR info, provider, mode                                   │
│       │  • Unverified banner (if judge failed)                               │
│       │  • Failed specialists warning                                        │
│       │  • Critical issues alert                                             │
│       │  • Findings by category (icon + severity + location + message)       │
│       │  • Code snippets                                                     │
│       │  • Stats: categories, API calls, tokens, cost estimate               │
│       │  • Specialist breakdown                                              │
│       │                                                                      │
│       ▼                                                                      │
│  postReviewComment(token, prNumber, markdown)                                │
│       │  Upsert: find existing comment by marker → update or create          │
│       │  Embed state marker: <!-- ai-pr-reviewer-state: {...} -->            │
│       │                                                                      │
│       ▼                                                                      │
│  postInlineReview(token, prNumber, diff, findings)                           │
│       │  • Filter findings with file + line                                  │
│       │  • Map to valid diff lines (nearest-line relocation)                 │
│       │  • Dedup against existing bot comments                               │
│       │  • Batch via pulls.createReview (fallback: individual comments)      │
│       │                                                                      │
│       ▼                                                                      │
│  Persist state:                                                              │
│       • comment-marker: embedded in comment body                             │
│       • gist: JSON file keyed by repo-pr_number                              │
│       │                                                                      │
│       ▼                                                                      │
│  Set outputs:                                                                │
│       • review_body, has_critical_issues, categories_reviewed, findings_count │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
PR Review/
├── action.yml                    # GitHub Action metadata (inputs, outputs, entry point)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── ARCHITECTURE.md               # This file
├── dist/
│   └── index.js                  # Bundled output (ncc build)
├── src/
│   ├── index.ts                  # Entry point — orchestrates full pipeline
│   ├── config/                   # ← NEW: Centralized configuration layer
│   │   ├── index.ts              # Barrel re-export of all config modules
│   │   ├── app.ts               # Action inputs, env vars, severity rubric, JSON schemas
│   │   ├── allowed-extensions.ts # Whitelist of reviewable file extensions + filenames
│   │   ├── ignore-patterns.ts   # Glob patterns to skip + binary extension detection
│   │   └── file-rules.ts        # Per-filetype review rules, risk weights, hints
│   ├── findings.ts               # Finding types, JSON parsing, validation, dedup
│   ├── redact.ts                 # Secret redaction before LLM calls
│   ├── sanitize.ts               # Error sanitization in logs
│   ├── retry.ts                  # Retry + timeout wrapper for LLM API calls
│   ├── cost.ts                   # Approximate token cost estimation
│   ├── agents/
│   │   ├── index.ts              # Public API (re-exports runReview)
│   │   ├── orchestrator.ts       # Fan-out to specialists → judge → format
│   │   ├── specialist.ts         # One LLM call per domain category
│   │   ├── judge.ts              # Dedup findings with parse retry + fallback
│   │   ├── prompts.ts            # System/user prompt builders with injection guards
│   │   ├── format.ts             # Renders final PR comment markdown
│   │   ├── types.ts              # Shared agent types (SpecialistResult, TokenUsage)
│   │   └── guidelines/           # Built-in review rules per category
│   │       ├── index.ts          # Barrel export of all guidelines
│   │       ├── security.ts       # Injection, XSS, hardcoded secrets, auth gaps
│   │       ├── tests.ts          # Missing tests, flaky patterns, tautological tests
│   │       ├── performance.ts    # N+1 queries, unbounded memory, blocking ops
│   │       └── code-guidelines.ts # Error handling, race conditions, null safety
│   ├── context/
│   │   ├── index.ts              # Barrel export
│   │   ├── diff.ts               # Risk scoring, budget allocation, diff/file context
│   │   └── ignore.ts             # Glob-based file filtering (imports from config/)
│   ├── github/
│   │   ├── index.ts              # Barrel export
│   │   ├── client.ts             # Octokit factory + repo context helper
│   │   ├── types.ts              # PullRequestData, FetchPROptions interfaces
│   │   ├── pr-data.ts            # Fetch PR metadata, diff, changed files
│   │   ├── file-contents.ts      # Fetch full file contents from head branch
│   │   └── comments.ts           # Upsert summary comment, post inline comments
│   ├── providers/
│   │   ├── index.ts              # createProvider factory + AIProvider re-export
│   │   ├── types.ts              # AIProvider interface, ReviewRequest/Response
│   │   ├── anthropic.ts          # Anthropic Claude API (with prompt caching)
│   │   ├── openai.ts             # OpenAI Chat Completions (json_object mode)
│   │   └── azure.ts              # Azure OpenAI (deployment URL parsing)
│   ├── state/
│   │   ├── index.ts              # Barrel export
│   │   └── store.ts              # GistStateStore, CommitStatusStore, factory
│   ├── cli/
│   │   └── local-review.ts       # CLI for local testing
│   └── __tests__/                # Node.js built-in test runner tests
└── .github/
    └── workflows/
        └── ci.yml                # CI: lint, test, build; self-reviews PRs
```

---

## Config Layer (`src/config/`)

The config folder centralizes all file-level decisions:

### `allowed-extensions.ts`

Controls **which files enter the review pipeline** at all:

| Category | Extensions |
|----------|-----------|
| JavaScript/TypeScript | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyi` |
| C/C++ | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` |
| Go | `.go` |
| Rust | `.rs` |
| Java/Kotlin | `.java`, `.kt`, `.kts` |
| C# | `.cs` |
| Ruby | `.rb` |
| PHP | `.php` |
| Swift | `.swift` |
| Shell | `.sh`, `.bash`, `.zsh` |
| Config/Data | `.txt`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.ini`, `.cfg` |
| Web | `.html`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte` |
| SQL | `.sql` |
| Infra | `.dockerfile`, `.tf`, `.hcl` |

**Special filenames** (no extension needed): `Dockerfile`, `Makefile`, `Jenkinsfile`, `Procfile`, `Gemfile`, `Rakefile`, `.eslintrc`, `.prettierrc`, `.babelrc`

### `ignore-patterns.ts`

Files that are **never reviewed** regardless of extension:

| Category | Examples |
|----------|---------|
| Dependencies | `node_modules/`, `vendor/`, `.venv/`, `_packages/` |
| Build outputs | `dist/`, `build/`, `.next/`, `target/`, `.gradle/` |
| VCS/IDE | `.git/`, `.svn/`, `.vscode/`, `.idea/`, `.cursor/`, `.claude/` |
| Lock files | `package-lock.json`, `yarn.lock`, `Cargo.lock`, `poetry.lock` |
| Generated code | `*.pb.go`, `*_generated.*`, `*.gen.*` |
| Binary/media | Images, fonts, archives, audio/video, compiled objects |
| Bundled assets | `*.min.js`, `*.min.css`, `*.bundle.js`, `*.map` |
| CI/Docs | `.github/`, `*.md`, `LICENSE` |
| Caches | `.happypack/`, `.cachefile/`, `rpm/`, `pkgs/` |
| Environment | `.env`, `.env.*` |

### `file-rules.ts`

Per-filetype **review hints and risk weights** injected into specialist prompts:

| File Type | Risk Weight | Key Review Focus |
|-----------|-------------|-----------------|
| `package.json` | 1.2 | Unmaintained deps, loose versions, postinstall scripts |
| `requirements.txt` | 1.2 | Unpinned deps, untrusted indexes, deprecated packages |
| `Cargo.toml` | 1.2 | Unsafe features, wildcard versions, untrusted git repos |
| `.c` / `.cpp` | 1.5 | Buffer overflows, use-after-free, format strings |
| `.py` | 1.0 | pickle/yaml.load, shell=True, mutable defaults |
| `.ts` / `.tsx` | 1.0 | `any` usage, non-null assertions, ts-ignore |
| `.js` / `.jsx` | 1.0 | eval(), prototype pollution, strict equality |
| `.go` | 1.0 | Unchecked errors, goroutine leaks, data races |
| `.rs` | 1.0 | Unsafe blocks without SAFETY comments, unwrap() |
| `.java` / `.kt` | 1.0 | Deserialization, SQL injection, resource leaks |
| `.rb` | 1.0 | eval/send with user input, mass assignment |
| `.php` | 1.1 | exec/eval with input, file inclusion, unserialize |
| `.sh` / `.bash` | 1.3 | Unquoted vars, curl pipe sh, missing set -euo |
| `.sql` | 1.3 | DELETE without WHERE, DROP without IF EXISTS |
| `Dockerfile` | 1.3 | Latest tag, running as root, secrets in build args |
| `.tf` / `.hcl` | 1.4 | 0.0.0.0/0 ingress, hardcoded secrets, `Action: "*"` |
| `.yaml` / `.yml` | 0.8 | Hardcoded secrets, permissive CORS |
| `.css` / `.scss` | 0.4 | Minimal review — external url(), CSS expressions |

---

## Module Reference

| Module | Path | Responsibility |
|--------|------|----------------|
| **Entry** | `src/index.ts` | Top-level pipeline: config → fetch PR → review → post comments |
| **Config/App** | `src/config/app.ts` | Resolves action inputs, env vars, defaults; JSON schema + severity rubric |
| **Config/Extensions** | `src/config/allowed-extensions.ts` | Whitelist of reviewable file extensions and filenames |
| **Config/Ignore** | `src/config/ignore-patterns.ts` | DEFAULT_IGNORE_PATTERNS + BINARY_EXTENSIONS |
| **Config/Rules** | `src/config/file-rules.ts` | Per-filetype review hints, risk weights, matchers |
| **Orchestrator** | `src/agents/orchestrator.ts` | Fan-out to specialists, collect results, run judge, format output |
| **Specialist** | `src/agents/specialist.ts` | One LLM call per domain category; parses JSON findings |
| **Judge** | `src/agents/judge.ts` | Deduplicate specialist findings with parse retry + fallback |
| **Prompts** | `src/agents/prompts.ts` | System/user prompt builders with injection guards |
| **Format** | `src/agents/format.ts` | Renders final PR markdown (findings, failures, cost stats) |
| **PR Data** | `src/github/pr-data.ts` | Fetches PR metadata, diff, changed files; filters ignored paths |
| **File Contents** | `src/github/file-contents.ts` | Fetches full file contents from PR head branch (concurrent, max 10) |
| **Comments** | `src/github/comments.ts` | Upserts summary comment; posts inline review comments |
| **Context** | `src/context/diff.ts` | Risk-scores files, allocates token budget, builds diff/file sections |
| **Ignore** | `src/context/ignore.ts` | Glob-based file filtering (uses config/ignore-patterns) |
| **Providers** | `src/providers/` | Uniform `AIProvider` interface over Anthropic, OpenAI, Azure |
| **Findings** | `src/findings.ts` | Structured finding model; parsing, filtering, dedup, sorting |
| **Redact** | `src/redact.ts` | Secret redaction before sending to LLMs |
| **Sanitize** | `src/sanitize.ts` | Strips API keys from failure messages in logs |
| **Retry** | `src/retry.ts` | Exponential backoff on 429/5xx/timeouts for LLM API calls |
| **Cost** | `src/cost.ts` | Approximate token cost estimation for review footer |
| **State** | `src/state/store.ts` | Persists last_reviewed_sha (gist or comment marker) |

---

## Multi-Agent Topology

### Specialists (Stage 1 — Parallel)

Up to 5 specialist agents run concurrently via `Promise.allSettled`:

| Specialist | Focus | System Prompt Includes |
|------------|-------|----------------------|
| **Security** | Vulnerabilities, auth issues, injection, secrets | Injection tracing, XSS, hardcoded secrets, auth gaps, crypto misuse |
| **Tests** | Missing tests, coverage gaps, test quality | Branch analysis, tautological tests, flaky patterns |
| **Performance** | N+1 queries, memory leaks, blocking ops | Loop-bound I/O, unbounded queries, algorithmic complexity |
| **Code Quality** | Correctness, error handling, best practices | Error handling gaps, race conditions, null safety, logic errors |
| **Custom** | User-defined review guidelines | User-provided repo context |

Each specialist receives:
- A **system prompt** with: injection guard → role → HOW TO REVIEW (4 steps) → guidelines → JSON schema → review policy
- A **user prompt** with: PR metadata → file summary → risk-scored diff/file sections → "Now review" instruction

### Judge (Stage 2)

A single LLM call consolidates specialist output:

1. **Dedup** — Three-condition duplicate rule (same function + same guard + same failure mode)
2. **Parse retry** — If JSON parsing fails, retry once with same prompt
3. **Degraded fallback** — If still unparseable, mechanical dedup by category+file+line

---

## Context Building Strategy

```
                      File Arrives
                          │
                          ▼
                 ┌─────────────────┐
                 │ isAllowedFile() │ ← config/allowed-extensions.ts
                 │ Extension check │
                 └────────┬────────┘
                          │
                   allowed │ blocked → skip entirely
                          ▼
                 ┌─────────────────┐
                 │shouldIgnoreFile()│ ← config/ignore-patterns.ts
                 │ Glob matching   │
                 └────────┬────────┘
                          │
                not ignored│ ignored → skip entirely
                          ▼
                 ┌─────────────────┐
                 │  isBinaryFile() │ ← config/ignore-patterns.ts
                 │ Extension check │
                 └────────┬────────┘
                          │
                     text │ binary → skip content fetch
                          ▼
                 ┌─────────────────┐
                 │   scoreFile()   │ ← context/diff.ts
                 │                 │
                 │ • Path patterns │
                 │ • Line count    │
                 │ • New file      │
                 │ • Test file     │
                 │ • File rules    │ ← config/file-rules.ts (risk weight)
                 └────────┬────────┘
                          │
      ┌───────────────────┼───────────────────┐
      ▼                   ▼                   ▼
   HIGH RISK          MEDIUM RISK         LOW RISK
   (score ≥ 0.6)      (0.3 ≤ score < 0.6)  (score < 0.3)
      │                   │                   │
  <diff> + <file>      <diff> only          Excluded
  (full content)
```

---

## Risk Scoring Factors

| Factor | Score Impact |
|--------|-------------|
| Auth/payment/secret paths | +0.95 |
| Admin/internal paths | +0.85 |
| Migration/schema paths | +0.80 |
| Config/settings paths | +0.75 |
| Middleware/util/shared paths | +0.75 |
| Router/controller/handler paths | +0.60 |
| New file bonus | +0.15 |
| 300+ changed lines | +0.15 |
| 100+ changed lines | +0.10 |
| 50+ changed lines | +0.05 |
| Delete-only changes | -0.10 |
| Test files (non-test specialist) | capped at 0.2 |
| Test files (test specialist) | boosted to 0.8 |
| C/C++ files (file rule) | ×1.5 weight |
| Terraform files (file rule) | ×1.4 weight |
| Shell/SQL/Docker files | ×1.3 weight |
| CSS/stylesheets | ×0.4 weight |

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
| `issues.listComments` / `createComment` / `updateComment` | Summary review comment (upsert by HTML marker) |
| `pulls.createReview` / `createReviewComment` | Inline diff comments |
| `pulls.listReviewComments` | Dedup existing inline comments |
| `gists.get` / `gists.update` | State persistence (gist backend) |

**Permissions required:** `contents: read`, `pull-requests: write`

### LLM Providers

| Provider | SDK | Notes |
|----------|-----|-------|
| **Anthropic** | `@anthropic-ai/sdk` | `messages.create`, temp=0, supports `cache_control` blocks |
| **OpenAI** | `openai` | Chat Completions, `response_format: json_object` |
| **Azure OpenAI** | `openai` (`AzureOpenAI`) | Parses endpoint URL, uses deployment name as model |

All providers go through `withRetry()` — 3 attempts, exponential backoff, configurable timeout (120s default).

---

## Security Controls

| Control | Description |
|---------|-------------|
| **Secret Redaction** | Secrets are stripped from diffs and file contents before sending to LLMs (`redact.ts`) |
| **Injection Guards** | Untrusted PR content wrapped in `<pr_description>`, `<diff>`, `<file>` delimiters |
| **Error Sanitization** | API keys stripped from failure messages in logs (`sanitize.ts`) |
| **Degraded Judge Fallback** | If judge JSON parsing fails after retry, specialist findings are published with an unverified banner |
| **Infra Failure Handling** | If the judge API call itself fails after exhausting retries, the action fails closed |
| **Diff-Anchored Findings** | After judge dedup, only findings with file:line on a changed line survive |
| **Vague Finding Filter** | Findings starting with "Ensure/Consider/Verify" are auto-dropped |
| **Low Confidence Filter** | Findings with confidence: "low" are auto-dropped |
| **File Filtering Pipeline** | Three-layer gate: allowed extensions → ignore patterns → binary detection |

---

## Finding Lifecycle

```
File arrives in PR
  → isAllowedFile()? → shouldIgnoreFile()? → isBinaryFile()?
    → Only reviewable text files pass through
      → Risk-scored and budgeted into specialist context
        → Specialist raw JSON response
          → extractJson() + parse
            → Filter: low confidence → DROP
            → Filter: vague phrasing → DROP
            → Filter: missing file/snippet → DROP
              → Judge dedup: three-condition rule, merge duplicates
                → Parse retry on failure (1 attempt)
                → Degraded fallback: mechanical dedup
                  → filterFindingsToDiff(): only diff-touching lines survive
                    → sortFindingsForReview(): critical > warning > suggestion
                      → Final StructuredReview (max 8 findings)
                        → Posted as summary comment + inline comments
```

---

## Incremental Review (State Persistence)

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

---

## Key Design Decisions

1. **Multi-agent over monolith** — Parallel domain experts plus a judge for quality control, rather than a single monolithic prompt
2. **Three-layer file filtering** — Allowed extensions → ignore patterns → binary detection ensures only relevant text files reach the LLM
3. **Per-filetype review hints** — File-specific rules (risk weights + security guidance) tailored to each language and file type
4. **Context over diff-only** — Full file contents for high-risk files so reviewers see complete functions/APIs
5. **Budget-aware context** — Risk scoring prevents blowing token limits on large PRs
6. **Quality gates at multiple layers** — Injection guards, specialist filters, judge dedup, diff-anchoring, vague-message filters, confidence filters, 8-finding cap
7. **Resilient fan-out** — `Promise.allSettled` so one crashed specialist doesn't kill the pipeline; failures surfaced in PR comment
8. **Judge parse retry + fallback** — One retry on parse failure; then mechanical dedup with unverified banner
9. **Single-file distribution** — `ncc` bundle makes the action self-contained with no runtime `npm install`
10. **Incremental review via persisted state** — `last_reviewed_sha` stored per PR to diff only new changes, preventing infinite-findings loop

---

## Entry Points

| Layer | Path |
|-------|------|
| Source entry | `src/index.ts` → calls `main()` at module load |
| Compiled entry | `dist/index.js` (produced by `ncc build src/index.ts`) |
| Action entry | `action.yml` → `runs.main: dist/index.js` on Node 20 |
| CLI entry | `src/cli/local-review.ts` → local testing via `npm run local-review` |

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
