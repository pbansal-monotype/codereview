export declare function parseIgnorePatterns(input: string): string[];
export declare function shouldIgnoreFile(filename: string, patterns: string[]): boolean;
export declare function filterDiffByFiles(diff: string, ignoredFiles: Set<string>): string;
