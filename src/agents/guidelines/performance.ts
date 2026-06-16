export const PERFORMANCE_GUIDELINES = `
STEP 0 — ESTABLISH EXECUTION CONTEXT (do this before judging anything)
- Runtime & concurrency model: Node/single-threaded event loop? JVM/Go thread-or-goroutine-
  per-request? Serverless? This DETERMINES whether synchronous I/O is a problem. Blocking I/O
  on a Node request handler blocks all requests; the same call in a thread-per-request model
  blocks only one thread and is usually fine.
- Call context: request handler (hot path) vs. startup/migration/CLI/build script (not hot).
- What is N? For every loop/query, identify what it iterates over and whether N grows with
  users or data volume, and roughly how large it can realistically get.
If you cannot establish these, lower your confidence accordingly — do not assert impact you
can't ground.

WHAT TO FLAG
1. N+1 / loop-bound I/O — a DB query, network call, or file read inside a loop body.
   Include BOTH explicit calls (fetchProfile(id) in a loop) AND implicit ORM lazy-loads
   (accessing a relation property inside a loop). ORM lazy-loads usually can't be confirmed
   from the diff alone → flag at confidence:"low".
2. Unbounded result sets — a query with no LIMIT whose row count grows with user/tenant data.
   You CANNOT see table sizes. State the data-volume assumption explicitly and condition
   severity on it. Do NOT assert "will OOM" as fact. A query bounded by a small-cardinality
   foreign key is fine and should not be flagged.
3. Algorithmic complexity — O(n²) or worse ONLY when N can realistically reach thousands+
   AND it is on a hot path. Do not flag O(n²) on inherently small collections (cart lines,
   form fields, config) — the constant factor is dwarfed by surrounding I/O.
4. Event-loop blocking — synchronous blocking calls (readFileSync, execSync, sleep,
   JSON.parse on unbounded input) ONLY in a single-threaded request path (confirmed in Step 0).
5. Memory accumulation — pushing to an array / building a string in a loop ONLY when you can
   establish the accumulator outlives request scope (module-level, cache, long-lived stream
   handler). If the accumulator is request-scoped and gets GC'd, it is NOT a finding.
6. Missing pagination — new list/search endpoints returning all rows. Check the route def and
   whether existing pagination helpers/middleware are available and unused.

SCOPE RULE
Flag an issue if THIS PR introduces or materially worsens it — even if the expensive operation
lives in pre-existing/unchanged code that the changed code now calls in a loop or puts on a
hot path. Do not limit yourself to the + lines.

DO NOT FLAG
- Code that runs once: startup, build, migration, seed, admin/CLI scripts.
- Micro-optimizations: forEach vs for-of, string concat, spread vs assign on small objects.
- "Consider caching" unless you name exactly what is redundantly fetched and how often.
- Missing indexes — you cannot see the schema, query plan, or table size.
- Async/await in non-hot-path code.

SEVERITY
- P0: production-breaking under realistic load (unbounded growth on a hot path reaching
  thousands+, event-loop blocking on a per-request handler in single-threaded runtime,
  OOM risk under a clearly-stated and plausible data assumption).
- P1: significant degradation, not breaking (N+1 with bounded-but-large N, missing pagination
  on a list endpoint, O(n²) reaching thousands on a warm path).
Report all P0 and P1. Drop anything below P1 — prefer silence over noise. Zero findings is a
valid, good result. If you find more than 5 P0/P1, report the top 5 and note in "summary" that
the PR likely has a systemic performance problem.
`.trim();
