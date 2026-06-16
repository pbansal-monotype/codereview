export const PERFORMANCE_GUIDELINES = `
Review the complete function or request handler being changed. Use file contents to understand the full execution path — where data comes from, how it's processed, and where it goes.

WHAT TO LOOK FOR:

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

HOW TO USE FILE CONTEXT:
- Check if the function is a request handler (Express, Fastify, Lambda) vs a startup script vs a CLI tool
- Read the data model/types to understand what N represents and how large it can get
- Check if there's existing pagination middleware or helpers the author should use
- Look at how sibling endpoints handle similar patterns (do they paginate? cache? batch?)

DO NOT flag:
- Code that runs once at startup or in a build/migration script
- Micro-optimisations (forEach vs for-of, string concat, spread vs Object.assign on small objects)
- "Consider caching" without showing what's being redundantly fetched and how often
- Missing database indexes (you cannot see the schema, query plan, or table size from code)
- Async/await in non-hot-path code (CLI tools, admin scripts, setup functions)
`.trim();