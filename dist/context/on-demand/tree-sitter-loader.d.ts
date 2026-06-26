import type Parser from 'tree-sitter';
export type TreeSitterLang = 'python' | 'go';
interface TreeSitterParsers {
    python: Parser;
    go: Parser;
}
/**
 * Lazy-load tree-sitter native bindings. GitHub Actions runs Linux + Node 24;
 * dist must be built on that target (see CI). If the .node addon is missing or
 * built for the wrong OS/ABI, returns null and callers fall back to text-match.
 */
export declare function getTreeSitterParsers(): TreeSitterParsers | null;
/** @internal Test-only reset */
export declare function resetTreeSitterLoaderForTests(): void;
export {};
//# sourceMappingURL=tree-sitter-loader.d.ts.map