import { SECURITY_GUIDELINES } from './security';
import { TESTS_GUIDELINES } from './tests';
import { PERFORMANCE_GUIDELINES } from './performance';
import { COST_GUIDELINES } from './cost';

export const DEFAULT_GUIDELINES: Record<string, string> = {
  security: SECURITY_GUIDELINES,
  tests: TESTS_GUIDELINES,
  performance: PERFORMANCE_GUIDELINES,
  cost: COST_GUIDELINES,
};
