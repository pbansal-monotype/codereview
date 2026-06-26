import { SECURITY_GUIDELINES } from './security';
import { PERFORMANCE_GUIDELINES } from './performance';

export const DEFAULT_GUIDELINES: Record<string, string> = {
  security: SECURITY_GUIDELINES,
  code: PERFORMANCE_GUIDELINES,
};
