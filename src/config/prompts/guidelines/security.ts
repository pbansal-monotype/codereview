export const SECURITY_GUIDELINES = `
Review the complete function, endpoint, or module being changed — not just individual lines.
Use the full file contents to trace data flow: where does user input enter, how does it travel, and where does it reach a sink?

WHAT TO LOOK FOR:

1. **Injection (SQL, NoSQL, Command, LDAP)**
   - Trace user input from request params/body/headers through to database queries or shell commands.
   - Flag when user input reaches a query without parameterisation. Show the full data flow path.
   - Example: "req.body.name flows into db.query(\`SELECT * FROM users WHERE name = '\${name}'\`) at line 42 → SQL injection → use db.query('SELECT * FROM users WHERE name = ?', [name])"

2. **Cross-Site Scripting (XSS)**
   - Check if user input reaches HTML output, template rendering, or dangerouslySetInnerHTML without escaping.
   - Review the complete render function to see if any branch outputs unescaped input.

3. **Hardcoded Secrets**
   - Look for string literals that match patterns: API keys, passwords, tokens, connection strings.
   - Quote the pattern you found (first few chars + last few) as proof. Don't flag env var usage.

4. **Authentication & Authorization Gaps**
   - When a new route/endpoint is added, check the file context to see if sibling routes use auth middleware.
   - If the new route LACKS auth that sibling routes HAVE, flag it. Show both the protected and unprotected routes.

5. **Dangerous Deserialization**
   - eval(), Function(), pickle.loads(), yaml.load() without SafeLoader, JSON.parse on unchecked input used in security-sensitive contexts.

6. **Cryptographic Misuse**
   - ECB mode, MD5/SHA1 for password hashing, hardcoded IVs, Math.random() for security tokens.
   - Only flag when you can see the actual misuse in the code.

7. **Path Traversal**
   - User input reaching fs.readFile, fs.writeFile, path.join without sanitisation.
   - Check if the function validates/sanitises the path before use.

HOW TO USE FILE CONTEXT:
- Read the imports to understand what frameworks/libraries are used (Express? Django? Spring?)
- Check if auth middleware is applied at router level vs route level
- Trace type definitions to understand what data flows where
- Look at error handlers to see if they expose internal state

DO NOT flag:
- Environment variables (correct pattern)
- Error messages with HTTP status codes or non-sensitive operational info
- Dependencies without evidence of a known CVE in the changed code
- Anything in test files unless actual secrets are committed
- Generic "input validation" without showing the specific unvalidated input path
`.trim();
