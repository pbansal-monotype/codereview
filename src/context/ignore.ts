const DEFAULT_IGNORE_PATTERNS = [
  // dependency directories
  '**/node_modules/**',
  '**/vendor/**',
  // build outputs
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/out/**',
  '**/coverage/**',
  // version-control internals
  '**/.git/**',
  // lock files (large, machine-generated, no review value)
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Gemfile.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  // markdown docs (no review value)
  '**/README.md',
  '**/README*',
  '**/CHANGELOG.md',
  '**/CHANGELOG*',
  '**/*.md',
  // VCS / editor config
  '**/.gitignore',
  '**/.gitattributes',
  // CI/CD config — workflow files, not application logic
  '**/.github/**',
  // test fixtures and mocks — not application logic
  '**/__mocks__/**',
  '**/__fixtures__/**',
  '**/*__testdata__*',
  // minified / bundled assets
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  // source maps
  '**/*.map',
  // generated / vendored code
  '**/*.pb.go',
  '**/*_generated.*',
  '**/*.gen.*',
  // test snapshots
  '**/*.snap',
  // binary / media assets
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.ico',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
  '**/*.pdf',
  '**/*.zip',

  // env files
  '**/*.env',
  '**/*.env.example',
  '**/*.env.*',
  '**/*.env.*.*',
  '**/*.env.*.*.*',
  '**/*.env.*.*.*.*',
];

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Match a filename against a single glob (supports ** and basename fallbacks). */
function matchGlob(filename: string, glob: string): boolean {
  const basename = filename.includes('/')
    ? filename.slice(filename.lastIndexOf('/') + 1)
    : filename;

  if (globToRegex(glob).test(filename)) return true;

  // **/foo.json also matches root-level foo.json
  if (glob.startsWith('**/')) {
    const rest = glob.slice(3);
    if (rest.endsWith('/**')) {
      const dir = rest.slice(0, -3);
      if (filename.includes(`/${dir}/`) || filename.startsWith(`${dir}/`)) return true;
    } else if (basename === rest || filename.endsWith(`/${rest}`)) {
      return true;
    }
  }

  // *.min.js matches basename
  if (glob.startsWith('*.') && globToRegex(glob).test(basename)) return true;

  return false;
}

export function parseIgnorePatterns(input: string): string[] {
  const custom = input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return [...DEFAULT_IGNORE_PATTERNS, ...custom];
}

export function shouldIgnoreFile(filename: string, patterns: string[]): boolean {
  const allPatterns = patterns.length > 0 ? patterns : DEFAULT_IGNORE_PATTERNS;
  return allPatterns.some((glob) => matchGlob(filename, glob));
}

export function filterDiffByFiles(diff: string, ignoredFiles: Set<string>): string {
  if (ignoredFiles.size === 0) return diff;

  const chunks = diff.split(/(?=^diff --git )/m);
  const kept: string[] = [];

  for (const chunk of chunks) {
    if (!chunk.startsWith('diff --git ')) {
      if (chunk) kept.push(chunk);
      continue;
    }
    const match = chunk.match(/^diff --git a\/(.+?) b\//m);
    const file = match?.[1];
    if (file && ignoredFiles.has(file)) continue;
    kept.push(chunk);
  }

  return kept.join('');
}

// ─── Binary file detection (skip content fetch) ───────────────────

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.br',
  '.mp3', '.mp4', '.mov', '.avi',
  '.wasm', '.pyc', '.class', '.o', '.so', '.dll',
]);

/** True when a file path has a binary/media extension and should not be fetched as text. */
export function isBinaryFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
