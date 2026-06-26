// npx ts-node src/cli/local-review.ts --repo owner/name --pr 414 [--debug | --no-debug]
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, MAX_FILE_SIZE } from '../config';
import { createProvider } from '../providers';
import { shouldIgnoreFile } from '../filter';
import { prepareDiffForReview } from '../context/diff';
import { fetchFileContents } from '../github/file-contents';
import { getOctokit } from '../github/client';
import { runReview } from '../agents';
import type { PullRequestData } from '../github';

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
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
function parseArgs(argv: string[]): { repo: string; pr: number; debug: boolean } {
  let repo = '';
  let prStr = '';
  let debug = true; // local-review is for testing — include full stats by default
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
      'Usage: ts-node src/cli/local-review.ts --repo owner/name --pr 123 [--debug | --no-debug]',
    );
  }

  const pr = Number(prStr);
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`Invalid --pr value: "${prStr}"`);
  }

  return { repo, pr, debug };
}

async function buildPullRequestData(
  repoSlug: string,
  prNumber: number,
  githubToken: string,
  ignorePatterns: string[],
): Promise<PullRequestData> {
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid --repo value: "${repoSlug}". Expected owner/name.`);
  }

  const octokit = getOctokit(githubToken);

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

  const ignoredFiles = allFiles.filter((f) => shouldIgnoreFile(f, ignorePatterns));
  const reviewedFiles = allFiles.filter((f) => !shouldIgnoreFile(f, ignorePatterns));

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

    const { repo, pr, debug } = parseArgs(process.argv.slice(2));

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

    const prData = await buildPullRequestData(
      repo,
      pr,
      githubToken,
      config.ignorePatterns,
    );

    const result = await runReview(provider, config, prData, { debug });

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

void main();

