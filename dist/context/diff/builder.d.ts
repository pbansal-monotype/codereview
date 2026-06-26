import type { BuildReviewContextOptions, IncludedFile, ReviewContext, SkippedFile } from './types';
export declare function buildReviewContext(rawDiff: string, fileContents: Record<string, string>, charBudget: number, options?: BuildReviewContextOptions): ReviewContext;
export declare function buildFileSummary(includedFiles: IncludedFile[], skippedFiles: SkippedFile[]): string;
//# sourceMappingURL=builder.d.ts.map