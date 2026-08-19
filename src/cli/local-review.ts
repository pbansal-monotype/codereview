// npx ts-node src/cli/local-review.ts --repo owner/name --pr 414 [--debug | --no-debug]
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, MAX_FILE_SIZE } from '../config';
import { createProvider } from '../providers';
import { prepareDiffForReview } from '../context/diff';
import { partitionFiles } from '../github/pr-data';
import { fetchFileContents } from '../github/file-contents';
import { getOctokit, type Octokit } from '../github/client';
import { runReview } from '../agents';
import { formatReviewMarkdown } from '../output/format';
import { hasCriticalFindings } from '../output/findings';
import {
  buildRunRecord,
  createHistoryStore,
  structuredFromHistoryFindings,
} from '../history';
import type { PullRequestData } from '../github';

export function loadDotEnv(envPath = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
export function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  debug: boolean;
  force: boolean;
} {
  let repo = '';
  let prStr = '';
  let debug = true; // local-review is for testing — include full stats by default
  let force = false;
  const unknown: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo' && i + 1 < argv.length) {
      repo = argv[++i];
    } else if (arg === '--pr' && i + 1 < argv.length) {
      prStr = argv[++i];
    } else if (arg === '--debug' || arg === '-d') {
      debug = true;
    } else if (arg === '--no-debug') {
      debug = false;
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--') {
      // npm/ts-node argument separator — skip
    } else if (arg.startsWith('--')) {
      unknown.push(arg);
    }
  }

  if (unknown.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `Warning: unrecognized flag(s): ${unknown.join(', ')}` +
      (unknown.some((f) => f.includes('deubg') || f.includes('debag'))
        ? ' — did you mean --debug?'
        : ''),
    );
  }

  if (!repo || !prStr) {
    throw new Error(
      'Usage: ts-node src/cli/local-review.ts --repo owner/name --pr 123 [--debug | --no-debug] [--force]',
    );
  }

  const pr = Number(prStr);
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`Invalid --pr value: "${prStr}"`);
  }

  return { repo, pr, debug, force };
}

export async function buildPullRequestData(
  repoSlug: string,
  prNumber: number,
  githubToken: string,
  ignorePatterns: string[],
  octokit: Octokit = getOctokit(githubToken),
): Promise<PullRequestData> {
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid --repo value: "${repoSlug}". Expected owner/name.`);
  }

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Fetch full PR diff
  const { data: fullDiff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });
  const rawDiff = fullDiff as unknown as string;

  // List all changed files (paginated)
  const allFiles: string[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    allFiles.push(...data.map((f) => f.filename));
    if (data.length < 100) break;
    page += 1;
  }

  const { reviewedFiles, ignoredFiles } = partitionFiles(allFiles, ignorePatterns);

  const { diff, redactionCount } = await prepareDiffForReview(
    rawDiff,
    new Set(ignoredFiles),
    { redactSecrets: true },
  );

  const fileContents = await fetchFileContents(
    octokit,
    owner,
    repo,
    pr.head.ref,
    new Set(reviewedFiles),
    MAX_FILE_SIZE,
    true,
  );

  return {
    number: prNumber,
    title: pr.title,
    body: pr.body ?? '',
    diff,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    author: pr.user?.login ?? 'unknown',
    changedFiles: allFiles,
    reviewedFiles,
    ignoredFiles,
    redactionCount,
    fileContents,
    isIncremental: false,
    incrementalBaseSha: undefined,
  };
}

async function main(): Promise<void> {
  try {
    loadDotEnv();

    const { repo, pr, debug, force } = parseArgs(process.argv.slice(2));

    // eslint-disable-next-line no-console
    console.log(`Debug stats: ${debug ? 'on' : 'off'}`);

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error(
        'GITHUB_TOKEN env var is required for local review (with repo:pull-requests:read scope).',
      );
    }

    const config = loadConfig();
    const provider = createProvider(
      config.provider,
      config.apiKey,
      config.model,
      config.azureEndpoint,
    );

    const historyStore = createHistoryStore(config.history);
    if (historyStore) {
      // eslint-disable-next-line no-console
      console.log(`History tracking enabled → ${config.history.supabaseUrl}`);
    }

    const startedAt = Date.now();
    const prData = await buildPullRequestData(
      repo,
      pr,
      githubToken,
      config.ignorePatterns,
    );

    const enabledCategories = Object.entries(config.categories)
      .filter(([, g]) => g.enabled)
      .map(([id]) => id);

    if (!force && historyStore) {
      const prior = await historyStore.findReviewForSha(repo, pr, prData.headSha);
      if (prior) {
        // eslint-disable-next-line no-console
        console.log(
          `Commit ${prData.headSha.slice(0, 7)} already reviewed (run ${prior.runId}) — ` +
          `reusing ${prior.findings.length} cached finding(s). Pass --force to re-run the LLM.`,
        );
        const structured = structuredFromHistoryFindings(prior.findings);
        const markdown = formatReviewMarkdown({
          structured,
          pr: prData,
          config,
          categories: enabledCategories,
          totalTokens: { input: 0, output: 0 },
          apiCalls: 0,
          specialistResults: [],
        });
        const { run, findings } = buildRunRecord({
          repo,
          pr: prData,
          config,
          structured,
          categories: enabledCategories,
          inputTokens: 0,
          outputTokens: 0,
          apiCalls: 0,
          durationMs: Date.now() - startedAt,
          cached: true,
          githubContext: { actor: 'local-review', workflow: 'local-review' },
        });
        const runId = await historyStore.record(run, findings);
        const outPath = path.resolve(process.cwd(), 'test.md');
        fs.writeFileSync(outPath, markdown, 'utf8');
        // eslint-disable-next-line no-console
        console.log(runId ? `History run id: ${runId} (cached)` : 'History write failed (see warnings above)');
        // eslint-disable-next-line no-console
        console.log(`Wrote local review markdown to ${outPath}`);
        // eslint-disable-next-line no-console
        console.log(
          `has_critical_issues=${hasCriticalFindings(structured)} findings_count=${structured.findings.length} (cached, no LLM)`,
        );
        return;
      }
    }

    const result = await runReview(provider, config, prData, { debug });

    if (historyStore) {
      const { run, findings } = buildRunRecord({
        repo,
        pr: prData,
        config,
        structured: result.structured,
        categories: result.categories,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        apiCalls: result.apiCalls,
        durationMs: Date.now() - startedAt,
        cached: false,
        specialistResults: result.specialistResults,
        githubContext: {
          actor: 'local-review',
          workflow: 'local-review',
        },
      });
      const runId = await historyStore.record(run, findings);
      // eslint-disable-next-line no-console
      console.log(runId ? `History run id: ${runId}` : 'History write failed (see warnings above)');
    }

    const outPath = path.resolve(process.cwd(), 'test.md');
    fs.writeFileSync(outPath, result.markdown, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`Wrote local review markdown to ${outPath}`);
    // eslint-disable-next-line no-console
    console.log(
      `has_critical_issues=${result.hasCritical} findings_count=${result.structured?.findings.length ?? 0}${debug ? ' (debug stats included)' : ''}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`Local review failed: ${msg}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

