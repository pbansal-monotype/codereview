import * as core from '@actions/core';
import type Parser from 'tree-sitter';

export type TreeSitterLang = 'python' | 'go';

interface TreeSitterParsers {
  python: Parser;
  go: Parser;
}

type LoadState = 'pending' | 'ready' | 'unavailable';

let loadState: LoadState = 'pending';
let parsers: TreeSitterParsers | null = null;

/**
 * Lazy-load tree-sitter native bindings. GitHub Actions runs Linux + Node 24;
 * dist must be built on that target (see CI). If the .node addon is missing or
 * built for the wrong OS/ABI, returns null and callers fall back to text-match.
 */
export function getTreeSitterParsers(): TreeSitterParsers | null {
  if (loadState === 'ready') return parsers;
  if (loadState === 'unavailable') return null;

  try {
    // Dynamic require so a bad native binding does not crash module init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Parser = require('tree-sitter') as typeof import('tree-sitter');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Python = require('tree-sitter-python') as Parser.Language;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Go = require('tree-sitter-go') as Parser.Language;

    const pythonParser = new Parser();
    pythonParser.setLanguage(Python);

    const goParser = new Parser();
    goParser.setLanguage(Go);

    parsers = { python: pythonParser, go: goParser };
    loadState = 'ready';
    return parsers;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(
      `tree-sitter native bindings unavailable (${msg}). ` +
        'Python/Go reference lookup will use text-match fallback.',
    );
    loadState = 'unavailable';
    parsers = null;
    return null;
  }
}

/** @internal Test-only reset */
export function resetTreeSitterLoaderForTests(): void {
  loadState = 'pending';
  parsers = null;
}
