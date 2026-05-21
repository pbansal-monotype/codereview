/**
 * Strip API keys and tokens from error messages before they reach workflow logs.
 */

export function sanitizeErrorMessage(message: string): string {
  let result = message;
  result = result.replace(/sk-ant-[A-Za-z0-9\-_]{20,}/g, 'sk-ant-***');
  result = result.replace(/sk-proj-[A-Za-z0-9\-_]{20,}/g, 'sk-proj-***');
  result = result.replace(/sk-[A-Za-z0-9]{20,}/g, 'sk-***');
  result = result.replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, 'AKIA***');
  result = result.replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, 'gh*_***');
  result = result.replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox*-***');
  result = result.replace(/Bearer\s+[A-Za-z0-9\-._~+/]{10,}=*/gi, 'Bearer ***');
  return result;
}
