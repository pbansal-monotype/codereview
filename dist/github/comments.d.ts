import type { Finding } from '../output/findings';
export declare function postReviewComment(token: string, prNumber: number, body: string): Promise<void>;
export declare function postInlineReview(token: string, prNumber: number, diff: string, findings: Finding[]): Promise<{
    posted: number;
    skipped: number;
}>;
//# sourceMappingURL=comments.d.ts.map