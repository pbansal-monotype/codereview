/**
 * File extensions that the reviewer will process.
 * Any file not matching these extensions is skipped before context building.
 */
export declare const ALLOWED_EXTENSIONS: Set<string>;
/**
 * Filenames (no extension match) that should always be reviewed.
 * These are matched exactly against the basename.
 */
export declare const ALLOWED_FILENAMES: Set<string>;
/** Returns true if the file should be included for review based on its extension or name. */
export declare function isAllowedFile(filePath: string): boolean;
//# sourceMappingURL=allowed-extensions.d.ts.map