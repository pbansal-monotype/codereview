export const CODE_GUIDELINES = `
Review the complete function, class, or module being changed. Use file contents to understand the codebase's existing patterns, conventions, and architecture.

WHAT TO LOOK FOR:

1. **Error Handling Gaps**
   - Read the complete function: are all failure paths handled? Are there try/catch blocks where needed?
   - Check if the function can throw but callers don't handle it. Trace through the call chain in the file context.
   - Check if error messages are meaningful (not swallowed silently, not generic "Something went wrong").
   - Example: "fetchUser() at line 25 can throw on network failure but the caller at line 42 has no try/catch → unhandled rejection will crash the process → wrap in try/catch and return a proper error response"

2. **API Contract & Input Validation**
   - New endpoints or public functions: do they validate inputs before processing?
   - Check the full handler: what happens with missing fields, wrong types, empty strings, negative numbers?
   - Compare with sibling handlers in the file — do they validate? If so, this one should too.
   - Example: "POST /users handler at line 30 uses req.body.email directly without validation → missing email will cause db.insert to fail with a cryptic error → validate with schema or check presence first"

3. **Resource Cleanup & Lifecycle**
   - Database connections, file handles, streams, timers opened but never closed.
   - Check the complete function: is there a finally block or cleanup path?
   - Example: "db.connect() at line 15 with no corresponding disconnect in finally → connection leak under error conditions → use try/finally or a connection pool"

4. **Inconsistency with Codebase Patterns**
   - The changed code uses a different pattern than the rest of the file for the same task.
   - Check sibling functions: if they use a helper, utility, or middleware, the new code should too.
   - Example: "Sibling routes use validateRequest() middleware (lines 10, 22, 35) but the new route at line 48 does raw validation inline → inconsistent and error-prone → use validateRequest()"

5. **Race Conditions & Concurrency**
   - Shared state modified without synchronisation in concurrent contexts.
   - Check-then-act patterns without atomicity (TOCTOU).
   - Example: "Read balance at line 20, then write updated balance at line 25 without a transaction → concurrent requests can cause double-spending → wrap in a database transaction"

6. **Null/Undefined Safety**
   - Accessing properties on values that could be null/undefined without checks.
   - Optional chaining missing where the type allows undefined.
   - Check the types and upstream data to understand if null is actually possible.

7. **Logic Errors**
   - Off-by-one errors in loops or slicing.
   - Wrong comparison operators (= vs ==, < vs <=).
   - Inverted conditions or missing negation.
   - Unreachable code after early returns.

HOW TO USE FILE CONTEXT:
- Read imports to understand what libraries, utilities, and patterns are available
- Check how sibling functions handle the same concerns (validation, auth, errors)
- Trace type definitions to understand what can be null/undefined
- Look at the module's public API to understand the contract
- Check if there are shared utilities the author should use instead of reimplementing

DO NOT flag:
- Style preferences (naming, formatting, bracket placement) — linters handle this
- "Could be refactored" without a concrete bug or correctness issue
- Missing TypeScript strict mode features unless they cause a real bug
- Code that works correctly but could be written "more elegantly"
- TODOs or commented-out code (those are intentional markers)
`.trim();
