import { ReviewConfig } from '../app';
import { type FindingSuppression } from '../../state/suppression';
export declare function buildSpecialistSystemPrompt(categoryId: string, guidelines: string, config: ReviewConfig): string;
/** Appends the specialist review instruction to the shared context. */
export declare function buildSpecialistUserPrompt(sharedContext: string, suppression?: FindingSuppression): string;
//# sourceMappingURL=specialist.d.ts.map