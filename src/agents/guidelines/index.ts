import { SECURITY_GUIDELINES } from './security';
import { TESTS_GUIDELINES } from './tests';
import { PERFORMANCE_GUIDELINES } from './performance';
import { CODE_GUIDELINES } from './code-guidelines';

export const DEFAULT_GUIDELINES: Record<string, string> = {
  security: SECURITY_GUIDELINES,
  tests: TESTS_GUIDELINES,
  performance: PERFORMANCE_GUIDELINES,
  code: CODE_GUIDELINES,
};
