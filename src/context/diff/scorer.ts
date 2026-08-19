import type { RiskPattern } from './types';
import { isTestFile, TEST_FILE_LOW_SCORE } from './loader';
import { getFileRiskWeight } from '../../config/file-rules/rules';

export const THRESHOLDS = {
  HIGH_RISK: 0.6,
  MEDIUM_RISK: 0.3,
} as const;

const NEW_FILE_BOOST = 0.15;

export const RISK_PATH_PATTERNS: RiskPattern[] = [
  { pattern: /auth|login|logout|session|token|jwt|oauth|saml|sso|password|credential/i, score: 0.95 },
  { pattern: /payment|billing|stripe|wallet|invoice|checkout|subscription/i,            score: 0.95 },
  { pattern: /secret|private.?key|api.?key|\.pem|\.pfx|\.p12/i,                         score: 0.95 },
  { pattern: /admin|internal|privileged|superuser|sudo/i,                               score: 0.85 },
  { pattern: /migration|schema|seed|db\/|database\//i,                                  score: 0.80 },
  { pattern: /config\/|settings\./i,                                                     score: 0.75 },
  { pattern: /middleware|interceptor|guard|policy|module|lib|library|util|helper|utils|common|shared/i,score: 0.75 },
  { pattern: /router|controller|handler|service|repository/i,                           score: 0.60 },
  { pattern: /index\.(js|ts|py|go|java|rb|php|c|cpp|h|swift|kt)$/i,                     score: 0.55 },
  { pattern: /\.env\.example$/i,                                                          score: 0.35 },
  { pattern: /\.md$|README|CHANGELOG|LICENSE|docs\//i,                                  score: 0.05 },
  { pattern: /package-lock\.json|yarn\.lock|\.lock$|dist\/|build\//i,                   score: 0.00 },
];

export function scoreFile(
  filePath: string,
  diffHunk: string,
  options: { isNew?: boolean } = {},
): number {
  if (isTestFile(filePath)) {
    return TEST_FILE_LOW_SCORE;
  }

  let patternScore: number | null = null;

  for (const { pattern, score: s } of RISK_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      if (patternScore === null || s > patternScore) {
        patternScore = s;
      }
    }
  }

  let score = patternScore !== null ? patternScore : 0.4;

  const linesChanged = (diffHunk.match(/^[+-]/gm) ?? []).length;
  if (linesChanged > 300)      score = Math.min(1.0, score + 0.15);
  else if (linesChanged > 100) score = Math.min(1.0, score + 0.10);
  else if (linesChanged > 50)  score = Math.min(1.0, score + 0.05);

  const additions = (diffHunk.match(/^\+[^+]/gm) ?? []).length;
  const deletions = (diffHunk.match(/^-[^-]/gm) ?? []).length;
  if (additions === 0 && deletions > 0) score = Math.max(0.0, score - 0.1);

  if (options.isNew) {
    score = Math.min(1.0, score + NEW_FILE_BOOST);
    const isLowPriority = patternScore !== null && patternScore <= 0.35;
    if (patternScore === null && !isLowPriority && score < THRESHOLDS.HIGH_RISK) {
      score = THRESHOLDS.HIGH_RISK;
    }
  }

  // Per-filetype risk weight (config/file-rules): scale scrutiny up for
  // high-blast-radius types (C/C++, IaC, shell, SQL) and down for low-risk
  // ones (stylesheets, data configs). Multiplicative so a 0.00 hard-skip stays
  // skipped and high-risk path scores saturate at the 1.0 cap.
  const riskWeight = getFileRiskWeight(filePath);
  score = score * riskWeight;

  return Math.min(1.0, score);
}
