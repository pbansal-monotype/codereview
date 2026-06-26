import { ReviewConfig } from '../app';
import { Finding } from '../../output/findings';
import { SpecialistResult } from '../../agents/types';
export declare function buildJudgeDedupSystemPrompt(config: ReviewConfig): string;
export declare function buildJudgeDedupUserPrompt(allFindings: Finding[]): string;
/** Collect all findings from specialist results, attaching category from each agent. */
export declare function collectSpecialistFindings(specialistResults: SpecialistResult[]): Finding[];
//# sourceMappingURL=judge.d.ts.map