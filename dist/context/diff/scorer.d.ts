import type { RiskPattern } from './types';
export declare const THRESHOLDS: {
    readonly HIGH_RISK: 0.6;
    readonly MEDIUM_RISK: 0.3;
};
export declare const RISK_PATH_PATTERNS: RiskPattern[];
export declare function scoreFile(filePath: string, diffHunk: string, options?: {
    isNew?: boolean;
}): number;
//# sourceMappingURL=scorer.d.ts.map