/**
 * Per-filetype review rules.
 * Each rule set provides focused guidance that supplements the category-level guidelines
 * when the reviewer encounters a file of that type.
 */

export interface FileRule {
  /** Glob patterns or extensions this rule applies to. */
  match: string[];
  /** Human-readable label for the file type. */
  label: string;
  /** Extra review instructions appended to the specialist prompt for matched files. */
  reviewHints: string;
  /** Risk weight multiplier (1.0 = normal, >1 = higher scrutiny). */
  riskWeight: number;
}

export const FILE_RULES: FileRule[] = [
  // ─── Package Manifests ─────────────────────────────────────────
  {
    match: ['**/package.json'],
    label: 'Node.js package manifest',
    riskWeight: 1.2,
    reviewHints: `
- Flag new dependencies that are unmaintained (no updates in 2+ years) or have known vulnerabilities.
- Check for version ranges that are too loose (e.g. "*" or ">=1.0.0") — prefer caret (^) or tilde (~).
- Verify scripts don't execute arbitrary remote code (curl | sh patterns).
- Flag devDependencies that belong in dependencies (runtime packages) and vice versa.
- Check for duplicate packages under different names.
- Watch for postinstall scripts that download or compile native binaries.`.trim(),
  },

  {
    match: ['**/requirements.txt', '**/requirements*.txt', '**/constraints.txt'],
    label: 'Python requirements file',
    riskWeight: 1.2,
    reviewHints: `
- Flag unpinned dependencies (missing == version) — they cause non-reproducible builds.
- Check for packages pulled from untrusted indexes (--index-url pointing to non-PyPI).
- Flag deprecated packages (e.g. pycrypto → pycryptodome).
- Verify no git+ssh:// URLs that could leak private repo access.
- Watch for packages with known security advisories.`.trim(),
  },

  {
    match: ['**/pyproject.toml', '**/setup.py', '**/setup.cfg'],
    label: 'Python project config',
    riskWeight: 1.2,
    reviewHints: `
- Verify build-system requires are pinned to compatible versions.
- Check for overly broad entry-point definitions.
- Flag dynamic version resolution that could be exploited.
- Ensure classifiers match the actual Python version support.`.trim(),
  },

  {
    match: ['**/Cargo.toml'],
    label: 'Rust crate manifest',
    riskWeight: 1.2,
    reviewHints: `
- Flag "unsafe" feature flags being enabled without justification.
- Check for wildcard dependencies (version = "*").
- Verify [patch] sections don't point to untrusted git repos.
- Watch for build.rs scripts that download external artifacts.`.trim(),
  },

  {
    match: ['**/go.mod'],
    label: 'Go module file',
    riskWeight: 1.1,
    reviewHints: `
- Flag replace directives pointing to local paths (won't work in CI).
- Check for indirect dependencies that should be direct.
- Verify Go version matches the project's minimum supported version.`.trim(),
  },

  {
    match: ['**/Gemfile'],
    label: 'Ruby Gemfile',
    riskWeight: 1.2,
    reviewHints: `
- Flag gems fetched from git sources without a ref/tag pin.
- Check for gems with known CVEs.
- Verify source blocks only reference rubygems.org or trusted mirrors.`.trim(),
  },

  {
    match: ['**/pom.xml', '**/build.gradle', '**/build.gradle.kts'],
    label: 'JVM build config',
    riskWeight: 1.1,
    reviewHints: `
- Flag snapshot dependencies in release builds.
- Check for repositories pointing to HTTP (not HTTPS).
- Verify plugin versions are pinned.
- Watch for custom repositories that could serve malicious artifacts.`.trim(),
  },

  // ─── JavaScript / TypeScript ───────────────────────────────────
  {
    match: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    label: 'JavaScript source',
    riskWeight: 1.0,
    reviewHints: `
- Check for eval(), Function(), or new Function() usage with dynamic input.
- Flag missing error handling on async operations (unhandled promise rejections).
- Watch for prototype pollution patterns (recursive merge without safeguards).
- Verify proper use of strict equality (=== vs ==) in security-sensitive comparisons.
- Flag global state mutations that could cause race conditions.`.trim(),
  },

  {
    match: ['**/*.ts', '**/*.tsx'],
    label: 'TypeScript source',
    riskWeight: 1.0,
    reviewHints: `
- Flag 'any' type usage that bypasses type safety in critical paths.
- Check for type assertions (as) that could mask runtime errors.
- Verify generics are properly constrained.
- Watch for @ts-ignore / @ts-expect-error that hide real type issues.
- Flag non-null assertions (!) on values that could legitimately be null.`.trim(),
  },

  // ─── Python ────────────────────────────────────────────────────
  {
    match: ['**/*.py'],
    label: 'Python source',
    riskWeight: 1.0,
    reviewHints: `
- Flag use of pickle.loads / yaml.load (without SafeLoader) on untrusted input.
- Check for subprocess calls with shell=True using unsanitized input.
- Watch for broad except clauses (bare except: or except Exception) that swallow errors.
- Verify f-strings in SQL queries are parameterized instead.
- Flag mutable default arguments (def foo(items=[])).
- Check for proper resource cleanup (use context managers / with statements).`.trim(),
  },

  // ─── C / C++ ───────────────────────────────────────────────────
  {
    match: ['**/*.c', '**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.h', '**/*.hpp'],
    label: 'C/C++ source',
    riskWeight: 1.5,
    reviewHints: `
- Flag buffer overflows: unchecked array indexing, strcpy/sprintf without bounds.
- Check for use-after-free patterns and dangling pointers.
- Watch for integer overflow in size calculations before allocation.
- Verify all malloc/calloc results are checked for NULL.
- Flag format string vulnerabilities (printf with user-controlled format).
- Check for proper RAII / resource cleanup in all exit paths.
- Watch for signed/unsigned comparison mismatches.`.trim(),
  },

  // ─── Go ────────────────────────────────────────────────────────
  {
    match: ['**/*.go'],
    label: 'Go source',
    riskWeight: 1.0,
    reviewHints: `
- Flag unchecked errors (err returned but not handled).
- Check for goroutine leaks (goroutines without cancellation / context).
- Watch for race conditions on shared state without sync primitives.
- Verify defer statements for resource cleanup are in the right scope.
- Flag use of unsafe package without strong justification.`.trim(),
  },

  // ─── Rust ──────────────────────────────────────────────────────
  {
    match: ['**/*.rs'],
    label: 'Rust source',
    riskWeight: 1.0,
    reviewHints: `
- Flag unsafe blocks without a SAFETY comment explaining the invariant.
- Check for unwrap()/expect() on Results in non-test code (prefer ? or proper handling).
- Watch for unbounded allocations (Vec::with_capacity with user-controlled size).
- Verify lifetimes are correct, especially in public API signatures.`.trim(),
  },

  // ─── Java / Kotlin ─────────────────────────────────────────────
  {
    match: ['**/*.java', '**/*.kt', '**/*.kts'],
    label: 'Java/Kotlin source',
    riskWeight: 1.0,
    reviewHints: `
- Flag deserialization of untrusted data (ObjectInputStream, Gson/Jackson with polymorphic types).
- Check for SQL injection via string concatenation in queries.
- Watch for resource leaks (streams, connections without try-with-resources).
- Verify null safety annotations match actual nullability.
- Flag overly broad catch blocks (catch Exception / catch Throwable).`.trim(),
  },

  // ─── Ruby ──────────────────────────────────────────────────────
  {
    match: ['**/*.rb'],
    label: 'Ruby source',
    riskWeight: 1.0,
    reviewHints: `
- Flag use of eval, send, or public_send with user input.
- Check for mass-assignment vulnerabilities (permit all / no strong params).
- Watch for SQL injection via string interpolation in queries.
- Verify proper use of strong parameters in controllers.
- Flag open() with user-controlled paths (can execute commands with |).`.trim(),
  },

  // ─── PHP ───────────────────────────────────────────────────────
  {
    match: ['**/*.php'],
    label: 'PHP source',
    riskWeight: 1.1,
    reviewHints: `
- Flag use of eval(), exec(), system(), passthru() with user input.
- Check for SQL injection via string interpolation (use prepared statements).
- Watch for file inclusion vulnerabilities (include/require with user input).
- Verify proper output escaping (htmlspecialchars) before rendering.
- Flag serialize/unserialize with untrusted data.`.trim(),
  },

  // ─── Shell Scripts ─────────────────────────────────────────────
  {
    match: ['**/*.sh', '**/*.bash', '**/*.zsh'],
    label: 'Shell script',
    riskWeight: 1.3,
    reviewHints: `
- Flag unquoted variables that could cause word splitting or globbing.
- Check for command injection via unsanitized variables in commands.
- Watch for curl | sh patterns (downloading and executing arbitrary code).
- Verify proper error handling (set -euo pipefail or equivalent).
- Flag use of eval with variable expansion.
- Check for TOCTOU races in file operations.`.trim(),
  },

  // ─── SQL ───────────────────────────────────────────────────────
  {
    match: ['**/*.sql'],
    label: 'SQL file',
    riskWeight: 1.3,
    reviewHints: `
- Flag destructive operations without WHERE clause (DELETE, UPDATE on all rows).
- Check for DROP TABLE/DATABASE without IF EXISTS guards.
- Verify migrations are reversible (have both up and down).
- Watch for privilege escalation (GRANT ALL, SUPERUSER).
- Flag raw user input in dynamic SQL construction.`.trim(),
  },

  // ─── Docker / Infrastructure ───────────────────────────────────
  {
    match: ['**/Dockerfile', '**/*.dockerfile'],
    label: 'Dockerfile',
    riskWeight: 1.3,
    reviewHints: `
- Flag use of latest tag (non-reproducible builds).
- Check for running as root without USER directive.
- Watch for secrets passed via build args (visible in image history).
- Verify multi-stage builds don't leak build-time secrets into final image.
- Flag ADD when COPY would suffice (ADD auto-extracts and fetches URLs).
- Check for unnecessary packages increasing attack surface.`.trim(),
  },

  {
    match: ['**/*.tf', '**/*.hcl'],
    label: 'Terraform/HCL config',
    riskWeight: 1.4,
    reviewHints: `
- Flag security groups with 0.0.0.0/0 ingress on sensitive ports.
- Check for hardcoded secrets in variables or locals.
- Verify state backend uses encryption at rest.
- Watch for overly permissive IAM policies (Action: "*", Resource: "*").
- Flag missing lifecycle prevent_destroy on stateful resources.`.trim(),
  },

  // ─── Config Files ──────────────────────────────────────────────
  {
    match: ['**/*.yaml', '**/*.yml'],
    label: 'YAML config',
    riskWeight: 0.8,
    reviewHints: `
- Flag hardcoded secrets, API keys, or passwords.
- Check for overly permissive CORS or security configurations.
- Verify environment-specific values aren't committed (should use env vars or secrets).
- Watch for anchor/alias abuse that obscures the actual config.`.trim(),
  },

  {
    match: ['**/*.json'],
    label: 'JSON config/data',
    riskWeight: 0.7,
    reviewHints: `
- Flag hardcoded secrets or tokens.
- Check for overly permissive configuration values.
- Verify schema compliance if the file has an associated $schema.
- Watch for excessively large inline data that should be external.`.trim(),
  },

  {
    match: ['**/*.toml', '**/*.ini', '**/*.cfg'],
    label: 'Config file (TOML/INI)',
    riskWeight: 0.7,
    reviewHints: `
- Flag hardcoded credentials or connection strings with passwords.
- Check for debug/dev flags that shouldn't ship to production.
- Verify sensitive values reference environment variables or vault paths.`.trim(),
  },

  // ─── Web (HTML/CSS) ────────────────────────────────────────────
  {
    match: ['**/*.html'],
    label: 'HTML file',
    riskWeight: 0.9,
    reviewHints: `
- Flag inline scripts with dynamic content (XSS vectors).
- Check for missing CSP meta tags on pages with user content.
- Watch for loading scripts from untrusted CDNs without SRI hashes.
- Verify forms have proper CSRF protection.`.trim(),
  },

  {
    match: ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less'],
    label: 'Stylesheet',
    riskWeight: 0.4,
    reviewHints: `
- Flag CSS expressions or behavior properties (legacy IE attack surface).
- Check for url() pointing to external untrusted resources.
- Minimal security/logic review — focus on obvious anti-patterns only.`.trim(),
  },
];

/**
 * Look up all matching rules for a given file path.
 * Multiple rules may match (e.g. a .ts file inside a specific directory).
 */
export function getFileRules(filePath: string): FileRule[] {
  return FILE_RULES.filter((rule) =>
    rule.match.some((pattern) => matchFileRule(filePath, pattern)),
  );
}

/** Compute the aggregate risk weight for a file based on matching rules. */
export function getFileRiskWeight(filePath: string): number {
  const rules = getFileRules(filePath);
  if (rules.length === 0) return 1.0;
  return Math.max(...rules.map((r) => r.riskWeight));
}

/** Collect review hints for a file to inject into specialist prompts. */
export function getFileReviewHints(filePath: string): string {
  const rules = getFileRules(filePath);
  if (rules.length === 0) return '';
  return rules
    .map((r) => `[${r.label}]\n${r.reviewHints}`)
    .join('\n\n');
}

// ─── Internal matcher ────────────────────────────────────────────

function matchFileRule(filePath: string, pattern: string): boolean {
  const basename = filePath.includes('/')
    ? filePath.slice(filePath.lastIndexOf('/') + 1)
    : filePath;

  // Exact basename match (e.g. "Dockerfile")
  if (!pattern.includes('/') && !pattern.includes('*')) {
    return basename === pattern;
  }

  // Extension glob: **/*.ext
  const extMatch = pattern.match(/^\*\*\/\*(\.\w+)$/);
  if (extMatch) {
    return filePath.endsWith(extMatch[1]) || basename.endsWith(extMatch[1]);
  }

  // Filename glob: **/filename
  const filenameMatch = pattern.match(/^\*\*\/([^*]+)$/);
  if (filenameMatch) {
    return basename === filenameMatch[1] || filePath.endsWith(`/${filenameMatch[1]}`);
  }

  // Filename with wildcard: **/requirements*.txt
  const wildcardMatch = pattern.match(/^\*\*\/([^*]*)(\*)([^*]*)$/);
  if (wildcardMatch) {
    const [, prefix, , suffix] = wildcardMatch;
    return basename.startsWith(prefix) && basename.endsWith(suffix);
  }

  return false;
}
