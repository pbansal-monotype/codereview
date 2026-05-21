/**
 * Strip API keys and tokens from error messages before they reach workflow logs.
 */
export declare function sanitizeErrorMessage(message: string): string;
