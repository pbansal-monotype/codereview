/**
 * Glob patterns for files that should never be sent to the reviewer.
 * These are machine-generated, binary, or have no review value.
 */
export const DEFAULT_IGNORE_PATTERNS = [
  // ─── Dependency directories ────────────────────────────────────
  '**/node_modules/**',
  '**/vendor/**',
  '**/bower_components/**',
  '**/.venv/**',
  '**/venv/**',
  '**/env/**',
  '**/__pycache__/**',
  '**/.tox/**',
  '**/_packages/**',

  // ─── Build outputs ─────────────────────────────────────────────
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/out/**',
  '**/coverage/**',
  '**/target/**',
  '**/.gradle/**',
  '**/bin/**',
  '**/obj/**',
  '**/.happypack/**',
  '**/.cachefile/**',
  '**/rpm/**',
  '**/pkgs/**',

  // ─── Version control internals ─────────────────────────────────
  '**/.git/**',
  '**/.svn/**',

  // ─── Lock files (large, machine-generated) ─────────────────────
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Gemfile.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Pipfile.lock',
  '**/flake.lock',

  // ─── Documentation (low review value) ──────────────────────────
  '**/README.md',
  '**/README*',
  '**/CHANGELOG.md',
  '**/CHANGELOG*',
  '**/LICENSE',
  '**/LICENSE.*',
  '**/*.md',

  // ─── VCS / editor config / IDE ──────────────────────────────────
  '**/.gitignore',
  '**/.gitattributes',
  '**/.editorconfig',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.cursor/**',
  '**/.claude/**',

  // ─── CI/CD config ──────────────────────────────────────────────
  '**/.github/**',

  // ─── Test fixtures and mocks ───────────────────────────────────
  '**/__mocks__/**',
  '**/__fixtures__/**',
  '**/*__testdata__*',
  '**/__snapshots__/**',

  // ─── Minified / bundled assets ─────────────────────────────────
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/*.chunk.js',

  // ─── Source maps ───────────────────────────────────────────────
  '**/*.map',

  // ─── Generated / vendored code ─────────────────────────────────
  '**/*.pb.go',
  '**/*_generated.*',
  '**/*.gen.*',
  '**/*.g.dart',
  '**/*.freezed.dart',
  '**/generated/**',
  '**/auto-generated/**',

  // ─── Test snapshots ────────────────────────────────────────────
  '**/*.snap',

  // ─── Binary / media assets ─────────────────────────────────────
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.ico',
  '**/*.webp',
  '**/*.svg',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
  '**/*.eot',
  '**/*.pdf',
  '**/*.zip',
  '**/*.tar',
  '**/*.gz',
  '**/*.br',
  '**/*.mp3',
  '**/*.mp4',
  '**/*.mov',
  '**/*.avi',
  '**/*.wasm',

  // ─── Environment files ─────────────────────────────────────────
  '**/*.env',
  '**/*.env.example',
  '**/*.env.*',
];

/**
 * Binary file extensions — files with these extensions cannot be fetched as text.
 * Used to skip content fetching entirely (not just ignore from review).
 */
export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg', '.bmp', '.tiff',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Archives
  '.zip', '.tar', '.gz', '.br', '.7z', '.rar', '.bz2',
  // Audio / Video
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.flac', '.ogg', '.webm',
  // Compiled / Binary
  '.wasm', '.pyc', '.pyo', '.class', '.o', '.so', '.dll', '.dylib', '.a',
  '.exe', '.bin', '.dat',
]);
