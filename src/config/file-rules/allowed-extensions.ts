/**
 * File extensions that the reviewer will process.
 * Any file not matching these extensions is skipped before context building.
 */
export const ALLOWED_EXTENSIONS = new Set([
  // JavaScript / TypeScript
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',

  // Python
  '.py',
  '.pyi',

  // C / C++
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',

  // Go
  '.go',

  // Rust
  '.rs',

  // Java / Kotlin / JVM
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  '.gradle',
  '.properties',

  // C#
  '.cs',

  // Ruby
  '.rb',

  // PHP
  '.php',

  // Swift
  '.swift',

  // Dart
  '.dart',

  // Elixir
  '.ex',
  '.exs',

  // Objective-C
  '.m',
  '.mm',

  // Lua / Perl
  '.lua',
  '.pl',
  '.pm',

  // Shell
  '.sh',
  '.bash',
  '.zsh',

  // Config / Data (reviewable)
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
  '.cfg',

  // Web
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',

  // SQL
  '.sql',

  // Schemas / IDLs
  '.proto',
  '.graphql',
  '.gql',
  '.prisma',

  // Dockerfiles & infra
  '.dockerfile',
  '.tf',
  '.tfvars',
  '.hcl',
]);

/**
 * Filenames whose extension is absent or not in ALLOWED_EXTENSIONS but which are
 * still worth reviewing. Matched exactly against the basename.
 *
 * Keep this in sync with FILE_RULES in ./rules.ts and the path patterns in
 * context/diff/scorer.ts — a file those declare reviewable but that fails
 * isAllowedFile() is silently dropped before scoring ever runs.
 */
export const ALLOWED_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Jenkinsfile',
  'Procfile',
  'Gemfile',
  'Rakefile',
  'CODEOWNERS',
  'go.mod',
  '.eslintrc',
  '.prettierrc',
  '.babelrc',
  // Scored 0.35 by the risk scorer — committed placeholders leak real secrets often enough to review.
  '.env.example',
  '.env.sample',
  '.env.template',
]);

/** Returns true if the file should be included for review based on its extension or name. */
export function isAllowedFile(filePath: string): boolean {
  const basename = filePath.includes('/')
    ? filePath.slice(filePath.lastIndexOf('/') + 1)
    : filePath;

  if (ALLOWED_FILENAMES.has(basename)) return true;

  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;

  return ALLOWED_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
