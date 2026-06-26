export const PERFORMANCE_GUIDELINES = `
Review the complete function, class, or module being changed. Use file contents to understand the full execution path — where data comes from, how it's processed, and where it goes.

WHAT TO LOOK FOR:

## Performance Issues

1. **N+1 Queries / Loop-Bound I/O**
   - Read the complete function to find loops. Check if any I/O operation (database query, API call, file read) happens inside the loop body.
   - Check the file context: is the loop iterating over user data? Is N bounded or unbounded?
   - Example: "for loop at line 20 iterates over \`users\` (unbounded array from DB) and calls \`fetchProfile(user.id)\` on each → N+1 API calls → batch with \`fetchProfiles(userIds)\`"

2. **Unbounded Queries**
   - New database queries without LIMIT, or list endpoints that return all rows.
   - Check the full handler: does any upstream code add pagination? If not, flag it.
   - Example: "db.query('SELECT * FROM orders WHERE user_id = ?') at line 35 has no LIMIT → user with 100K orders will OOM the server → add LIMIT and pagination params"

3. **Algorithmic Complexity**
   - Read the complete function to spot nested iterations. What is N? Can it be large?
   - Only flag O(n²)+ when N is user-controlled or grows with data volume.
   - Example: "\`items.filter()\` inside \`items.forEach()\` at lines 12-18 → O(n²) where n = cart items → use a Set for O(n) lookup"

4. **Blocking Operations in Async Context**
   - Check if the function is an async handler (Express route, Lambda handler, etc.) from the file context.
   - Flag synchronous blocking calls: fs.readFileSync, execSync, sleep, large JSON.parse on unbounded input.

5. **Unbounded Memory Accumulation**
   - Functions that push to arrays or build strings in loops without size limits.
   - Especially dangerous in stream handlers or long-running processes.
   - Check the full function to see if there's any bounds checking.

6. **Missing Pagination**
   - New list/search endpoints that could return large result sets.
   - Check the handler's full implementation and the route definition from file context.

## Code Quality & Correctness Issues

7. **Error Handling Gaps**
   - Read the complete function: are all failure paths handled? Are there try/catch blocks where needed?
   - Check if the function can throw but callers don't handle it. Trace through the call chain in the file context.
   - Check if error messages are meaningful (not swallowed silently, not generic "Something went wrong").
   - Example: "fetchUser() at line 25 can throw on network failure but the caller at line 42 has no try/catch → unhandled rejection will crash the process → wrap in try/catch and return a proper error response"

8. **API Contract & Input Validation**
   - New endpoints or public functions: do they validate inputs before processing?
   - Check the full handler: what happens with missing fields, wrong types, empty strings, negative numbers?
   - Compare with sibling handlers in the file — do they validate? If so, this one should too.
   - Example: "POST /users handler at line 30 uses req.body.email directly without validation → missing email will cause db.insert to fail with a cryptic error → validate with schema or check presence first"

9. **Resource Cleanup & Lifecycle**
   - Database connections, file handles, streams, timers opened but never closed.
   - Check the complete function: is there a finally block or cleanup path?
   - Example: "db.connect() at line 15 with no corresponding disconnect in finally → connection leak under error conditions → use try/finally or a connection pool"

10. **Race Conditions & Concurrency**
    - Shared state modified without synchronisation in concurrent contexts.
    - Check-then-act patterns without atomicity (TOCTOU).
    - Example: "Read balance at line 20, then write updated balance at line 25 without a transaction → concurrent requests can cause double-spending → wrap in a database transaction"

11. **Null/Undefined Safety**
    - Accessing properties on values that could be null/undefined without checks.
    - Optional chaining missing where the type allows undefined.
    - Check the types and upstream data to understand if null is actually possible.

12. **Logic Errors**
    - Off-by-one errors in loops or slicing.
    - Wrong comparison operators (= vs ==, < vs <=).
    - Inverted conditions or missing negation.
    - Unreachable code after early returns.

13. **Inconsistency with Codebase Patterns**
    - The changed code uses a different pattern than the rest of the file for the same task.
    - Check sibling functions: if they use a helper, utility, or middleware, the new code should too.
    - Example: "Sibling routes use validateRequest() middleware (lines 10, 22, 35) but the new route at line 48 does raw validation inline → inconsistent and error-prone → use validateRequest()"

HOW TO USE FILE CONTEXT:
- Check if the function is a request handler (Express, Fastify, Lambda) vs a startup script vs a CLI tool
- Read the data model/types to understand what N represents and how large it can get
- Check if there's existing pagination middleware or helpers the author should use
- Look at how sibling endpoints handle similar patterns (do they paginate? cache? batch?)
- Read imports to understand what libraries, utilities, and patterns are available
- Check how sibling functions handle the same concerns (validation, auth, errors)
- Trace type definitions to understand what can be null/undefined
- Look at the module's public API to understand the contract

DO NOT flag:
- Code that runs once at startup or in a build/migration script
- Micro-optimisations (forEach vs for-of, string concat, spread vs Object.assign on small objects)
- "Consider caching" without showing what's being redundantly fetched and how often
- Missing database indexes (you cannot see the schema, query plan, or table size from code)
- Async/await in non-hot-path code (CLI tools, admin scripts, setup functions)
- Style preferences (naming, formatting, bracket placement) — linters handle this
- "Could be refactored" without a concrete bug or correctness issue
- Missing TypeScript strict mode features unless they cause a real bug
- Code that works correctly but could be written "more elegantly"
- TODOs or commented-out code (those are intentional markers)
`.trim();
