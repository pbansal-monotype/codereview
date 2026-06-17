export declare function parseIgnorePatterns(input: string): string[];
export declare function shouldIgnoreFile(filename: string, patterns: string[]): boolean;
export declare function filterDiffByFiles(diff: string, ignoredFiles: Set<string>): string;
/** True when a file path has a binary/media extension and should not be fetched as text. */
export declare function isBinaryFile(filePath: string): boolean;
//# sourceMappingURL=ignore.d.ts.map