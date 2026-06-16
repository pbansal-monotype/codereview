/**
 * run-topologies.ts
 *
 * Runs the four topology variants on every PR fixture at temperature 0:
 *   - single-call / no-judge
 *   - single-call / with-judge
 *   - fan-out    / no-judge
 *   - fan-out    / with-judge  ← current production topology
 *
 * Only the topology varies; rubric, schema, and temperature are held constant.
 * Writes raw LLM responses to results/<run-id>/<fixture-id>/<topology>.json
 * for downstream scoring by score.ts.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx ts-node src/eval/run-topologies.ts [fixture-file]
 *   # fixture-file defaults to src/eval/fixtures/poisoned-prs.json
 *   # Override topology: --topologies single-no-judge,fanout-judge
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createProvider } from '../providers';
import { buildSharedContext, buildSpecialistUserPrompt, buildJudgeUserPrompt, buildJudgeSystemPrompt, buildSpecialistSystemPrompt } from '../agents/prompts';
import { parseSpecialistFindings, parseStructuredReview } from '../findings';
import { runJudge } from '../agents/judge';
import type { PullRequestData } from '../github';
import type { ReviewConfig } from '../config';
import type { SpecialistResult } from '../agents/types';
import type { PoisonedPRFixture } from './inject-defects';

// ─── Topology definitions ─────────────────────────────────────────

type TopologyId = 'single-no-judge' | 'single-judge' | 'fanout-no-judge' | 'fanout-judge';

const ALL_TOPOLOGIES: TopologyId[] = [
  'single-no-judge',
  'single-judge',
  'fanout-no-judge',
  'fanout-judge',
];

// ─── Helpers ──────────────────────────────────────────────────────

function makeMinimalConfig(apiKey: string): ReviewConfig {
  return {
    provider: 'anthropic',
    apiKey,
    model: 'claude-sonnet-4-20250514',
    githubToken: '',
    categories: {
      security: { enabled: true, guidelines: 'Check for injection, XSS, secrets, auth gaps.' },
      tests: { enabled: true, guidelines: 'Check for missing or broken tests.' },
      performance: { enabled: true, guidelines: 'Check for N+1, unbounded queries, blocking ops.' },
      code: { enabled: true, guidelines: 'Check error handling, null safety, race conditions.' },
      custom: { enabled: false, guidelines: '' },
    },
    customPrompt: '',
    extraInstructions: '',
    maxDiffSize: 60000,
    postReviewComment: false,
    postInlineComments: false,
    failOnCritical: false,
    ignorePatterns: [],
    redactSecrets: false,
    timeoutMs: 120000,
    includeFileContents: true,
    contextFiles: [],
    maxFileSize: 10000,
  };
}

// ─── Topology runners ─────────────────────────────────────────────

async function runSingleNoJudge(
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const provider = createProvider(config.provider, config.apiKey, config.model);
  const sharedContext = buildSharedContext(pr, config);
  // Single call: use the security specialist as a proxy for "one-shot" review.
  const systemPrompt = buildSpecialistSystemPrompt('security', config.categories.security.guidelines, config);
  const userPrompt = buildSpecialistUserPrompt(sharedContext);
  const response = await provider.review({ systemPrompt, userPrompt, timeoutMs: config.timeoutMs });
  const findings = parseSpecialistFindings(response.review, 'security');
  return { topology: 'single-no-judge', findings, tokensUsed: response.tokensUsed };
}

async function runSingleJudge(
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const provider = createProvider(config.provider, config.apiKey, config.model);
  const sharedContext = buildSharedContext(pr, config);
  const systemPrompt = buildSpecialistSystemPrompt('security', config.categories.security.guidelines, config);
  const userPrompt = buildSpecialistUserPrompt(sharedContext);
  const response = await provider.review({ systemPrompt, userPrompt, timeoutMs: config.timeoutMs });
  const findings = parseSpecialistFindings(response.review, 'security');

  const specialistResults: SpecialistResult[] = [
    { categoryId: 'security', findings, tokens: { input: response.inputTokens, output: response.outputTokens }, failed: false },
  ];
  const judgeResult = await runJudge(provider, specialistResults, pr, config, sharedContext, ['security']);
  return { topology: 'single-judge', findings: judgeResult.structured.findings, tokens: judgeResult.tokens };
}

async function runFanoutNoJudge(
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const provider = createProvider(config.provider, config.apiKey, config.model);
  const enabledCategories = ['security', 'tests', 'performance', 'code'] as const;
  const sharedContext = buildSharedContext(pr, config);
  const testSharedContext = buildSharedContext(pr, config, true);

  const results = await Promise.allSettled(
    enabledCategories.map(async (cat) => {
      const context = cat === 'tests' ? testSharedContext : sharedContext;
      const guidelines = config.categories[cat].guidelines;
      const systemPrompt = buildSpecialistSystemPrompt(cat, guidelines, config);
      const userPrompt = buildSpecialistUserPrompt(context);
      const response = await provider.review({ systemPrompt, userPrompt, timeoutMs: config.timeoutMs });
      return { category: cat, findings: parseSpecialistFindings(response.review, cat), tokens: response.tokensUsed };
    }),
  );

  const allFindings = results.flatMap((r) => r.status === 'fulfilled' ? r.value.findings : []);
  return { topology: 'fanout-no-judge', findings: allFindings };
}

async function runFanoutJudge(
  pr: PullRequestData,
  config: ReviewConfig,
): Promise<object> {
  const provider = createProvider(config.provider, config.apiKey, config.model);
  const enabledCategories = ['security', 'tests', 'performance', 'code'] as const;
  const sharedContext = buildSharedContext(pr, config);
  const testSharedContext = buildSharedContext(pr, config, true);

  const settled = await Promise.allSettled(
    enabledCategories.map(async (cat) => {
      const context = cat === 'tests' ? testSharedContext : sharedContext;
      const guidelines = config.categories[cat].guidelines;
      const systemPrompt = buildSpecialistSystemPrompt(cat, guidelines, config);
      const userPrompt = buildSpecialistUserPrompt(context);
      const response = await provider.review({ systemPrompt, userPrompt, timeoutMs: config.timeoutMs });
      const findings = parseSpecialistFindings(response.review, cat);
      return { categoryId: cat, findings, tokens: { input: response.inputTokens, output: response.outputTokens }, failed: false } as SpecialistResult;
    }),
  );

  const specialistResults: SpecialistResult[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { categoryId: enabledCategories[i], findings: [], tokens: { input: 0, output: 0 }, failed: true, error: String(r.reason) },
  );

  const judgeResult = await runJudge(provider, specialistResults, pr, config, sharedContext, [...enabledCategories]);
  return { topology: 'fanout-judge', findings: judgeResult.structured.findings, tokens: judgeResult.tokens };
}

// ─── CLI ──────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  const fixtureArg = process.argv[2] ?? path.join(__dirname, 'fixtures', 'poisoned-prs.json');
  if (!fs.existsSync(fixtureArg)) {
    console.error(`Fixture file not found: ${fixtureArg}`);
    process.exit(1);
  }

  const fixtures: PoisonedPRFixture[] = JSON.parse(fs.readFileSync(fixtureArg, 'utf8'));
  const topologyArg = process.argv[3];
  const topologies: TopologyId[] = topologyArg
    ? (topologyArg.split(',') as TopologyId[])
    : ALL_TOPOLOGIES;

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, 'results', runId);
  fs.mkdirSync(resultsDir, { recursive: true });

  console.log(`Run ID: ${runId}`);
  console.log(`Fixtures: ${fixtures.length} | Topologies: ${topologies.join(', ')}`);

  const config = makeMinimalConfig(apiKey);

  for (const fixture of fixtures) {
    const fixtureDir = path.join(resultsDir, fixture.id);
    fs.mkdirSync(fixtureDir, { recursive: true });

    // Write ground truth alongside results for easy comparison.
    fs.writeFileSync(
      path.join(fixtureDir, 'ground-truth.json'),
      JSON.stringify(fixture.groundTruth, null, 2),
    );

    for (const topology of topologies) {
      console.log(`  [${fixture.id}] ${topology}...`);
      try {
        let result: object;
        const pr = fixture.pr as unknown as PullRequestData;
        if (topology === 'single-no-judge') result = await runSingleNoJudge(pr, config);
        else if (topology === 'single-judge') result = await runSingleJudge(pr, config);
        else if (topology === 'fanout-no-judge') result = await runFanoutNoJudge(pr, config);
        else result = await runFanoutJudge(pr, config);

        fs.writeFileSync(
          path.join(fixtureDir, `${topology}.json`),
          JSON.stringify(result, null, 2),
        );
      } catch (err) {
        console.error(`  [${fixture.id}] ${topology} FAILED:`, err);
        fs.writeFileSync(
          path.join(fixtureDir, `${topology}.error.json`),
          JSON.stringify({ error: String(err) }, null, 2),
        );
      }
    }
  }

  console.log(`\nResults written to: ${resultsDir}`);
  console.log(`Next step: npx ts-node src/eval/score.ts ${resultsDir}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
