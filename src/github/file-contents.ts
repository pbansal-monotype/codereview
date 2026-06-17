import { ghRequest, type Octokit } from './client';
import { isBinaryFile } from '../context/ignore';
import type { FileContent } from './types';

const FETCH_CONCURRENCY = 10;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

export async function fetchFileContents(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  files: Set<string>,
  maxFileSize: number,
  redactSecretsEnabled: boolean,
): Promise<FileContent[]> {
  const results: FileContent[] = [];
  const filePaths = [...files].filter((filePath) => !isBinaryFile(filePath));

  await runWithConcurrency(filePaths, FETCH_CONCURRENCY, async (filePath) => {
    try {
      const data = await ghRequest(
        () =>
          octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
            ref,
          }) as Promise<{
            data: { type?: string; content?: string };
            headers: Record<string, string | undefined>;
          }>,
        `getContent(${filePath})`,
      );

      if (!data.content || data.type !== 'file') return;

      let content = Buffer.from(data.content, 'base64').toString('utf-8');
      let truncated = false;

      if (content.length > maxFileSize) {
        content = content.slice(0, maxFileSize) + '\n// ... [file truncated] ...';
        truncated = true;
      }

      if (redactSecretsEnabled) {
        const { redactSecrets } = await import('../redact');
        content = redactSecrets(content);
      }

      results.push({ path: filePath, content, truncated });
    } catch {
      // File might not exist on the head branch (deleted file) — skip
    }
  });

  return results;
}
