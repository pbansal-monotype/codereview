import type { HistoryConfig } from '../config';
import type { HistoryStore } from './types';
export { SupabaseHistoryStore, RUNS_TABLE, FINDINGS_TABLE } from './supabase';
export { buildRunRecord, structuredFromHistoryFindings, type BuildRecordInput } from './record';
export type { HistoryStore, RunRecord, FindingRecord } from './types';
/**
 * Returns a history store when both the URL and key are configured, otherwise
 * null (history tracking is opt-in). A URL without a key is treated as a
 * misconfiguration worth warning about rather than failing the run.
 */
export declare function createHistoryStore(config: HistoryConfig): HistoryStore | null;
//# sourceMappingURL=index.d.ts.map