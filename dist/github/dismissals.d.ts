export declare const FINDING_MARKER_RE: RegExp;
export declare const DISMISS_MARKER_RE: RegExp;
export declare const DISMISS_REPLY_RE: RegExp;
/**
 * Collect finding fingerprints dismissed via:
 * - `<!-- ai-pr-dismiss: fingerprint -->` in PR issue comments
 * - `/dismiss` (or dismiss / won't fix / ignore) replies on inline review threads
 */
export declare function collectDismissedFingerprints(token: string, prNumber: number): Promise<Set<string>>;
//# sourceMappingURL=dismissals.d.ts.map