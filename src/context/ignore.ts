import { DEFAULT_IGNORE_PATTERNS, BINARY_EXTENSIONS } from '../config/ignore-patterns';
import { isAllowedFile } from '../config/allowed-extensions';

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

/** True when a file path has a binary/media extension and should not be fetched as text. */
export function isBinaryFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

// ─── Allowed-file filter (re-export for convenience) ──────────────

export { isAllowedFile };
