import { type Octokit } from './client';
import type { FileContent } from './types';
export declare function fetchFileContents(octokit: Octokit, owner: string, repo: string, ref: string, files: Set<string>, maxFileSize: number, redactSecretsEnabled: boolean): Promise<FileContent[]>;
//# sourceMappingURL=file-contents.d.ts.map