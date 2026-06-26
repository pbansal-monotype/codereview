export type ReferenceSource = 'semantic' | 'syntactic' | 'text-match';
export interface ReferenceLocation {
    file: string;
    line: number;
    snippet: string;
    source: ReferenceSource;
}
export interface ToolContext {
    /** All reviewable file contents keyed by repo-relative path. */
    fileContents: Record<string, string>;
    ignorePatterns: string[];
    cache: ToolCache;
}
/** Per-PR-run in-memory cache shared across tools and blast-radius pass. */
export declare class ToolCache {
    private readonly fileCache;
    private readonly searchCache;
    private readonly refCache;
    getFile(path: string): string | null | undefined;
    setFile(path: string, content: string | null): void;
    getSearch(key: string): ReferenceLocation[] | undefined;
    setSearch(key: string, results: ReferenceLocation[]): void;
    getReferences(key: string): ReferenceLocation[] | undefined;
    setReferences(key: string, results: ReferenceLocation[]): void;
}
export declare function createToolContext(fileContents: Record<string, string>, ignorePatterns?: string[], existingCache?: ToolCache): ToolContext;
export declare function readFile(ctx: ToolContext, filePath: string): string | null;
export declare function searchText(ctx: ToolContext, pattern: string, fileGlob?: string): ReferenceLocation[];
export declare function findReferences(ctx: ToolContext, symbol: string, filePath: string): ReferenceLocation[];
/** Repo-relative paths from GitHub never have a leading slash; normalize LLM/tool input. */
export declare function normalizeRepoPath(filePath: string): string;
/** Resolve whether caller content imports or requires the target module path. */
export declare function fileImportsTarget(callerContent: string, callerPath: string, targetPath: string): boolean;
/** Extract exported/changed symbol names from a file's diff hunk and content. */
export declare function extractSymbolsFromFile(filePath: string, diffHunk: string, content: string): string[];
/** Find caller locations in high-risk files that reference a low-risk target. */
export declare function findBlastRadiusCallers(ctx: ToolContext, targetPath: string, targetSymbols: string[], highRiskFiles: Array<{
    filePath: string;
    content: string;
}>, maxCallers?: number): ReferenceLocation[];
//# sourceMappingURL=tools.d.ts.map