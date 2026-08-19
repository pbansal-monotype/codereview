import * as core from '@actions/core';
import type { HistoryConfig } from '../config';
import { SupabaseHistoryStore } from './supabase';
import type { HistoryStore } from './types';

export { SupabaseHistoryStore, RUNS_TABLE, FINDINGS_TABLE } from './supabase';
export { buildRunRecord, structuredFromHistoryFindings, type BuildRecordInput } from './record';
export type { HistoryStore, RunRecord, FindingRecord } from './types';

/**
 * Returns a history store when both the URL and key are configured, otherwise
 * null (history tracking is opt-in). A URL without a key is treated as a
 * misconfiguration worth warning about rather than failing the run.
 */
export function createHistoryStore(config: HistoryConfig): HistoryStore | null {
  const hasUrl = config.supabaseUrl.length > 0;
  const hasKey = config.supabaseKey.length > 0;

  if (!hasUrl && !hasKey) return null;

  if (!hasUrl || !hasKey) {
    core.warning(
      `[history] History tracking needs both supabase_url and supabase_key ` +
        `(missing ${!hasUrl ? 'supabase_url' : 'supabase_key'}). Skipping history for this run.`,
    );
    return null;
  }

  return new SupabaseHistoryStore(config.supabaseUrl, config.supabaseKey);
}
