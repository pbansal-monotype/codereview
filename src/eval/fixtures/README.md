# Eval Fixtures Format

## `clean-prs.json`

Array of `CleanPRFixture` objects representing **clean** (defect-free) PRs.
These are the base cases onto which defects are injected.

```jsonc
[
  {
    "id": "pr-001-add-user-endpoint",
    "pr": {
      "number": 101,
      "title": "Add /users endpoint",
      "author": "alice",
      "body": "Adds a new REST endpoint to list users with pagination.",
      "headBranch": "feature/users",
      "baseBranch": "main",
      "diff": "diff --git a/src/routes/users.ts b/src/routes/users.ts\n...",
      "fileContents": [
        {
          "path": "src/routes/users.ts",
          "content": "export async function listUsers(...) { ... }",
          "truncated": false
        }
      ],
      "reviewedFiles": ["src/routes/users.ts"],
      "changedFiles": ["src/routes/users.ts"],
      "ignoredFiles": [],
      "redactionCount": 0
    }
  }
]
```

## `gold-annotations.json`

Array of human-annotated PR reviews used for **precision** evaluation.
Each entry annotates a real (not synthetic) PR with:
- `truePositives`: issues a senior engineer would genuinely flag
- `falsePositiveTraps`: patterns that look suspicious but are actually fine

```jsonc
[
  {
    "id": "pr-real-001",
    "pr": { "...same PullRequestData shape..." },
    "truePositives": [
      {
        "category": "security",
        "severity": "critical",
        "description": "SQL query built with string concatenation in getUserById",
        "file": "src/db.ts",
        "codeSnippet": "const q = `SELECT * FROM users WHERE id = ${id}`;"
      }
    ],
    "falsePositiveTraps": [
      {
        "category": "security",
        "description": "The HMAC validation looks incomplete but is handled upstream in middleware",
        "file": "src/handlers/auth.ts"
      }
    ]
  }
]
```

## Collecting gold annotations

1. Pick 40–60 real merged PRs from your repository.
2. Have 2+ senior engineers independently annotate each PR:
   - List genuine issues they would comment on in code review.
   - List any patterns that look suspicious but are actually fine.
3. Resolve disagreements by consensus; record the rationale.
4. Aim for a mix of PR sizes: small (≤5 files), medium (5–20), large (>20).

## Defect injection catalogue

`inject-defects.ts` injects the following known defects for the recall-floor eval:

| ID | Category | Severity | Description |
|----|----------|----------|-------------|
| `sql-injection` | security | critical | User input concatenated into SQL |
| `hardcoded-secret` | security | critical | API key literal in source |
| `n-plus-one-query` | performance | warning | DB query inside a for-loop |
| `missing-test-for-critical-path` | tests | warning | New auth function without test |
| `unhandled-promise-rejection` | code | warning | Floating promise without await/.catch |

The recall floor target is **≥ 0.5**: at least half of injected defects must be detected.
