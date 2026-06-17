# Eval Harness

Validates whether the multi-agent fan-out topology earns its cost before further investment.

## Why this exists

The current system runs 4 specialist agents + 1 judge per PR. That is 5× the LLM cost of a
single-call review. This harness measures whether the precision/recall improvement justifies
the cost — and answers the question before more work is poured into the topology.

## Methodology

### Guiding principles

- **Precision is the primary metric** (it drives adoption — developers stop reading reviews
  that are noisy). Recall is a constraint, not an optimization target.
- **Recall floor**: ≥ 0.5 — at least half of injected known defects must be caught.
- **Only topology varies** across runs. Rubric, schema, and temperature (0) are held constant.
- **Do not reward raw finding count.** A review with 2 true positives and 0 false positives
  outscores one with 10 findings and 8 false positives.

### Eval sets

Two complementary eval sets:

1. **Recall floor (synthetic)** — inject known defects into clean PRs using `inject-defects.ts`.
   Ground truth is 100% known. Measures whether the system can find defects at all.

2. **Precision gold standard (human-annotated)** — 40–60 real PRs annotated by senior engineers
   (see `fixtures/README.md`). Measures whether findings are genuinely useful vs. noise.

### Topologies under test

| ID | Description |
|----|-------------|
| `single-no-judge` | One LLM call, no judge (baseline cost) |
| `single-judge` | One specialist call + judge |
| `fanout-no-judge` | Parallel specialists, no judge |
| `fanout-judge` | Current production: parallel specialists + judge |

### Statistical analysis

- Run each topology 3–5 times per PR (at temp 0, results are deterministic per model version,
  but minor prompt variations can affect output; 3 runs is usually enough).
- Stratify by PR size: small (≤5 files), medium (5–20), large (>20).
- Paired Wilcoxon signed-rank test on precision across topologies (non-parametric, works with
  small n). Significance threshold: p < 0.05.

## Local agent testing (single diff file)

Use `run-agent-local.ts` to run one guideline specialist or the judge against a local
unified diff — useful for prompt iteration without GitHub or the full orchestrator.

```bash
# Run the security specialist on a GitHub Actions debug log or raw diff
npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent security

# Azure is the default provider — set AZURE_API_KEY / AZURE_ENDPOINT, or edit
# HARDCODED_AZURE_* constants at the top of run-agent-local.ts
npx ts-node src/eval/run-agent-local.ts changes.diff --agent performance --files-dir ./my-repo

# Run judge only (findings + diff extracted from GitHub Actions debug log)
npx ts-node src/eval/run-agent-local.ts --agent judge --findings Debug/judge.txt

# Or pass diff separately
npx ts-node src/eval/run-agent-local.ts Debug/securitylogs.txt --agent judge --findings specialists.json

# Run all specialists + judge end-to-end
npm run test-agent -- Debug/securitylogs.txt --agent all
```

Agents: `security`, `tests`, `performance`, `code`, `judge`, `all`.

## Running the eval

```bash
# 1. Generate poisoned PR fixtures from your clean PR fixtures
npx ts-node src/eval/inject-defects.ts

# 2. Run all topologies
ANTHROPIC_API_KEY=sk-... npx ts-node src/eval/run-topologies.ts src/eval/fixtures/poisoned-prs.json

# 3. Score and compare
npx ts-node src/eval/score.ts src/eval/results/<run-id>/
```

## Decision rule

After scoring:

- If `fanout-judge` precision > `single-judge` precision at p < 0.05: the fan-out earns its cost.
  Continue investing in the multi-agent topology.
- If the difference is not significant: simplify to `single-judge` (lower cost, same quality).
- If either topology fails the recall floor (< 0.5): fix the rubric before comparing topologies.

**Do not pour more engineering effort into the fan-out topology until these numbers exist.**

## Directory layout

```
src/eval/
├── inject-defects.ts     # Synthetic defect injection (recall floor)
├── run-topologies.ts     # Runs {single,fanout} × {no-judge,judge} on fixtures
├── score.ts              # Precision/recall + Wilcoxon signed-rank comparison
├── fixtures/
│   ├── README.md         # Fixture format spec + annotation guide
│   ├── clean-prs.json    # (you provide) clean PR fixtures
│   └── gold-annotations.json  # (you provide) human-annotated real PRs
└── results/
    └── <run-id>/
        ├── summary.json  # Aggregated scores + significance tests
        └── <fixture-id>/
            ├── ground-truth.json
            ├── fanout-judge.json
            ├── single-judge.json
            └── ...
```
