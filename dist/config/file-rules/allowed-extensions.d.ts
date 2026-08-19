/**
 * File extensions that the reviewer will process.
 * Any file not matching these extensions is skipped before context building.
 */
export declare const ALLOWED_EXTENSIONS: Set<string>;
/**
 * Filenames whose extension is absent or not in ALLOWED_EXTENSIONS but which are
 * still worth reviewing. Matched exactly against the basename.
 *
 * Keep this in sync with FILE_RULES in ./rules.ts and the path patterns in
 * context/diff/scorer.ts — a file those declare reviewable but that fails
 * isAllowedFile() is silently dropped before scoring ever runs.
 */
export declare const ALLOWED_FILENAMES: Set<string>;
/** Returns true if the file should be included for review based on its extension or name. */
export declare function isAllowedFile(filePath: string): boolean;
//# sourceMappingURL=allowed-extensions.d.ts.map