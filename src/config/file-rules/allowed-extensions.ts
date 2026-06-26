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

  // Java / Kotlin
  '.java',
  '.kt',
  '.kts',

  // C#
  '.cs',

  // Ruby
  '.rb',

  // PHP
  '.php',

  // Swift
  '.swift',

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

  // Dockerfiles & infra
  '.dockerfile',
  '.tf',
  '.hcl',
]);

/**
 * Filenames (no extension match) that should always be reviewed.
 * These are matched exactly against the basename.
 */
export const ALLOWED_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Jenkinsfile',
  'Procfile',
  'Gemfile',
  'Rakefile',
  '.eslintrc',
  '.prettierrc',
  '.babelrc',
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
