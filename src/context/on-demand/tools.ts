import { Project, type SourceFile } from 'ts-morph';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import { isAllowedFile, shouldIgnoreFile, isBinaryFile } from '../../filter';

// ─── Types ─────────────────────────────────────────────────────────

export type ReferenceSource = 'semantic' | 'syntactic' | 'text-match';

export interface ReferenceLocation {
  file: string;
  line: number;
  snippet: string;
  source: ReferenceSource;
}

export interface ToolContext {
  /** All reviewable file contents keyed by repo-relative path. */
  fileContents: Record<string, string>;
  ignorePatterns: string[];
  cache: ToolCache;
}

/** Per-PR-run in-memory cache shared across tools and blast-radius pass. */
export class ToolCache {
  private readonly fileCache = new Map<string, string | null>();
  private readonly searchCache = new Map<string, ReferenceLocation[]>();
  private readonly refCache = new Map<string, ReferenceLocation[]>();

  getFile(path: string): string | null | undefined {
    return this.fileCache.get(path);
  }

  setFile(path: string, content: string | null): void {
    this.fileCache.set(path, content);
  }

  getSearch(key: string): ReferenceLocation[] | undefined {
    return this.searchCache.get(key);
  }

  setSearch(key: string, results: ReferenceLocation[]): void {
    this.searchCache.set(key, results);
  }

  getReferences(key: string): ReferenceLocation[] | undefined {
    return this.refCache.get(key);
  }

  setReferences(key: string, results: ReferenceLocation[]): void {
    this.refCache.set(key, results);
  }
}

export function createToolContext(
  fileContents: Record<string, string>,
  ignorePatterns: string[] = [],
  existingCache?: ToolCache,
): ToolContext {
  return {
    fileContents,
    ignorePatterns,
    cache: existingCache ?? new ToolCache(),
  };
}

// ─── File filtering ────────────────────────────────────────────────

function isSearchableFile(filePath: string, ignorePatterns: string[]): boolean {
  if (!isAllowedFile(filePath)) return false;
  if (isBinaryFile(filePath)) return false;
  if (shouldIgnoreFile(filePath, ignorePatterns)) return false;
  return true;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(filePath: string, glob?: string): boolean {
  if (!glob) return true;
  const basename = filePath.includes('/')
    ? filePath.slice(filePath.lastIndexOf('/') + 1)
    : filePath;
  if (globToRegex(glob).test(filePath)) return true;
  if (glob.startsWith('**/')) {
    const rest = glob.slice(3);
    if (basename === rest || filePath.endsWith(`/${rest}`)) return true;
  }
  if (glob.startsWith('*.') && globToRegex(glob).test(basename)) return true;
  return false;
}

function snippetAroundLine(content: string, line: number, contextLines = 0): string {
  const lines = content.split('\n');
  const idx = Math.max(0, line - 1);
  const start = Math.max(0, idx - contextLines);
  const end = Math.min(lines.length, idx + contextLines + 1);
  return lines.slice(start, end).join('\n').trim();
}

// ─── read_file ─────────────────────────────────────────────────────

export function readFile(ctx: ToolContext, filePath: string): string | null {
  const cached = ctx.cache.getFile(filePath);
  if (cached !== undefined) return cached;

  if (!isSearchableFile(filePath, ctx.ignorePatterns)) {
    ctx.cache.setFile(filePath, null);
    return null;
  }

  const content = ctx.fileContents[filePath] ?? null;
  ctx.cache.setFile(filePath, content);
  return content;
}

// ─── search_text ───────────────────────────────────────────────────

export function searchText(
  ctx: ToolContext,
  pattern: string,
  fileGlob?: string,
): ReferenceLocation[] {
  const cacheKey = `${pattern}\0${fileGlob ?? '*'}`;
  const cached = ctx.cache.getSearch(cacheKey);
  if (cached) return cached;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'gm');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'gm');
  }

  const results: ReferenceLocation[] = [];

  for (const [filePath, content] of Object.entries(ctx.fileContents)) {
    if (!isSearchableFile(filePath, ctx.ignorePatterns)) continue;
    if (!matchesGlob(filePath, fileGlob)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) {
        regex.lastIndex = 0;
        continue;
      }
      regex.lastIndex = 0;
      results.push({
        file: filePath,
        line: i + 1,
        snippet: lines[i].trim(),
        source: 'text-match',
      });
    }
  }

  ctx.cache.setSearch(cacheKey, results);
  return results;
}

// ─── find_references ───────────────────────────────────────────────

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot < 0 ? '' : filePath.slice(dot).toLowerCase();
}

export function findReferences(
  ctx: ToolContext,
  symbol: string,
  filePath: string,
): ReferenceLocation[] {
  const cacheKey = `${symbol}\0${filePath}`;
  const cached = ctx.cache.getReferences(cacheKey);
  if (cached) return cached;

  const ext = extOf(filePath);
  let results: ReferenceLocation[];

  if (TS_EXTENSIONS.has(ext)) {
    results = findTsReferences(ctx, symbol, filePath);
  } else if (ext === '.py' || ext === '.pyi') {
    results = findTreeSitterReferences(ctx, symbol, filePath, 'python');
  } else if (ext === '.go') {
    results = findTreeSitterReferences(ctx, symbol, filePath, 'go');
  } else {
    results = searchText(ctx, `\\b${escapeRegex(symbol)}\\b`, undefined).filter(
      (r) => r.file !== filePath || !isDefinitionLine(ctx.fileContents[r.file], r.line, symbol),
    );
  }

  ctx.cache.setReferences(cacheKey, results);
  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDefinitionLine(content: string, line: number, symbol: string): boolean {
  const lineText = content.split('\n')[line - 1] ?? '';
  return new RegExp(
    `(?:function|class|const|let|var|def|func)\\s+${escapeRegex(symbol)}\\b`,
  ).test(lineText);
}

// ─── TypeScript / JavaScript (ts-morph) ────────────────────────────

let tsProject: Project | null = null;
let tsProjectFingerprint = '';

function getTsProject(ctx: ToolContext): Project {
  const paths = Object.keys(ctx.fileContents)
    .filter((p) => TS_EXTENSIONS.has(extOf(p)))
    .sort()
    .join('\0');
  if (tsProject && tsProjectFingerprint === paths) return tsProject;

  tsProject = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(ctx.fileContents)) {
    if (TS_EXTENSIONS.has(extOf(path))) {
      tsProject.createSourceFile(path, content, { overwrite: true });
    }
  }
  tsProjectFingerprint = paths;
  return tsProject;
}

function findTsReferences(
  ctx: ToolContext,
  symbol: string,
  filePath: string,
): ReferenceLocation[] {
  const project = getTsProject(ctx);
  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) return [];

  const namedDecl =
    sourceFile.getFunction(symbol) ??
    sourceFile.getClass(symbol) ??
    sourceFile.getInterface(symbol) ??
    sourceFile.getTypeAlias(symbol) ??
    sourceFile.getEnum(symbol) ??
    sourceFile.getVariableDeclaration(symbol);

  if (!namedDecl) {
    return findExportAliasReferences(sourceFile, symbol, ctx);
  }

  const results: ReferenceLocation[] = [];
  const refEntries = namedDecl.findReferences();

  for (const entry of refEntries) {
    for (const ref of entry.getReferences()) {
      if (ref.isDefinition()) continue;
      const node = ref.getNode();
      const sf = node.getSourceFile();
      const path = sf.getFilePath().replace(/^\//, '');
      if (!isSearchableFile(path, ctx.ignorePatterns)) continue;
      results.push({
        file: path,
        line: node.getStartLineNumber(),
        snippet: node.getText().slice(0, 200),
        source: 'semantic',
      });
    }
  }

  return dedupeReferences(results);
}

function findExportAliasReferences(
  sourceFile: SourceFile,
  symbol: string,
  ctx: ToolContext,
): ReferenceLocation[] {
  const exportDecls = sourceFile.getExportedDeclarations().get(symbol);
  if (!exportDecls || exportDecls.length === 0) return [];

  const results: ReferenceLocation[] = [];
  for (const exportDecl of exportDecls) {
    if (!('findReferences' in exportDecl) || typeof exportDecl.findReferences !== 'function') {
      continue;
    }
    const refEntries = exportDecl.findReferences();
    for (const entry of refEntries) {
      for (const ref of entry.getReferences()) {
        if (ref.isDefinition()) continue;
        const node = ref.getNode();
        const path = node.getSourceFile().getFilePath().replace(/^\//, '');
        if (!isSearchableFile(path, ctx.ignorePatterns)) continue;
        results.push({
          file: path,
          line: node.getStartLineNumber(),
          snippet: node.getText().slice(0, 200),
          source: 'semantic',
        });
      }
    }
  }

  return dedupeReferences(results);
}

// ─── Python / Go (tree-sitter) ─────────────────────────────────────

const pythonParser = new Parser();
pythonParser.setLanguage(Python as Parser.Language);

const goParser = new Parser();
goParser.setLanguage(Go as Parser.Language);

type TreeSitterLang = 'python' | 'go';

function findTreeSitterReferences(
  ctx: ToolContext,
  symbol: string,
  filePath: string,
  lang: TreeSitterLang,
): ReferenceLocation[] {
  const parser = lang === 'python' ? pythonParser : goParser;
  const identifierType = lang === 'python' ? 'identifier' : 'identifier';
  const results: ReferenceLocation[] = [];

  for (const [path, content] of Object.entries(ctx.fileContents)) {
    if (!isSearchableFile(path, ctx.ignorePatterns)) continue;

    const ext = extOf(path);
    const validExt =
      lang === 'python' ? ext === '.py' || ext === '.pyi' : ext === '.go';
    if (!validExt) continue;

    const tree = parser.parse(content);
    walkTree(tree.rootNode, (node) => {
      if (node.type !== identifierType) return;
      if (content.slice(node.startIndex, node.endIndex) !== symbol) return;

      const line = node.startPosition.row + 1;
      if (path === filePath && isDefinitionTreeNode(node, lang)) return;

      results.push({
        file: path,
        line,
        snippet: snippetAroundLine(content, line),
        source: 'syntactic',
      });
    });
  }

  return dedupeReferences(results);
}

function isDefinitionTreeNode(
  node: Parser.SyntaxNode,
  lang: TreeSitterLang,
): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (lang === 'python') {
    return (
      parent.type === 'function_definition' ||
      parent.type === 'class_definition' ||
      (parent.type === 'assignment' && parent.childForFieldName('left') === node)
    );
  }
  return (
    parent.type === 'function_declaration' ||
    parent.type === 'method_declaration' ||
    parent.type === 'type_declaration'
  );
}

function walkTree(
  node: Parser.SyntaxNode,
  visit: (node: Parser.SyntaxNode) => void,
): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i)!, visit);
  }
}

function dedupeReferences(refs: ReferenceLocation[]): ReferenceLocation[] {
  const seen = new Set<string>();
  const out: ReferenceLocation[] = [];
  for (const r of refs) {
    const key = `${r.file}:${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Blast-radius helpers (import/call detection) ──────────────────

/** Resolve whether caller content imports or requires the target module path. */
export function fileImportsTarget(
  callerContent: string,
  callerPath: string,
  targetPath: string,
): boolean {
  const candidates = modulePathCandidates(callerPath, targetPath);
  for (const candidate of candidates) {
    const patterns = [
      new RegExp(`from\\s+['"]${escapeRegex(candidate)}['"]`, 'm'),
      new RegExp(`import\\s+['"]${escapeRegex(candidate)}['"]`, 'm'),
      new RegExp(`require\\(\\s*['"]${escapeRegex(candidate)}['"]\\s*\\)`, 'm'),
      new RegExp(`import\\(\\s*['"]${escapeRegex(candidate)}['"]\\s*\\)`, 'm'),
    ];
    if (patterns.some((p) => p.test(callerContent))) return true;

    // Python: from pkg.mod import x / import pkg.mod
    const pyModule = candidate.replace(/\//g, '.').replace(/^\.\//, '');
    if (
      new RegExp(`(?:from|import)\\s+${escapeRegex(pyModule)}`, 'm').test(callerContent)
    ) {
      return true;
    }

    // Go: import "path/to/pkg"
    if (new RegExp(`import\\s+"[^"]*${escapeRegex(candidate)}"`, 'm').test(callerContent)) {
      return true;
    }
  }
  return false;
}

function modulePathCandidates(callerPath: string, targetPath: string): string[] {
  const callerDir = callerPath.includes('/')
    ? callerPath.slice(0, callerPath.lastIndexOf('/'))
    : '';

  const noExt = targetPath.replace(/\.[^./]+$/, '');
  const candidates = new Set<string>([
    targetPath,
    noExt,
    `./${targetPath}`,
    `./${noExt}`,
  ]);

  if (callerDir) {
    const rel = relativePath(callerDir, noExt);
    candidates.add(rel);
    candidates.add(rel.startsWith('.') ? rel : `./${rel}`);
  }

  return [...candidates];
}

function relativePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/');
  const toParts = toPath.split('/');
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const prefix = ups === 0 ? './' : '../'.repeat(ups);
  return prefix + toParts.slice(i).join('/');
}

/** Extract exported/changed symbol names from a file's diff hunk and content. */
export function extractSymbolsFromFile(
  filePath: string,
  diffHunk: string,
  content: string,
): string[] {
  const symbols = new Set<string>();
  const ext = extOf(filePath);

  const addedLines = diffHunk
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));

  for (const line of addedLines) {
    const patterns = [
      /export\s+(?:async\s+)?function\s+(\w+)/,
      /export\s+class\s+(\w+)/,
      /export\s+(?:const|let|var)\s+(\w+)/,
      /export\s+default\s+function\s*(\w+)?/,
      /export\s*\{\s*([^}]+)\}/,
      /(?:async\s+)?function\s+(\w+)/,
      /class\s+(\w+)/,
      /def\s+(\w+)\s*\(/,
      /func\s+(\w+)\s*\(/,
    ];
    for (const p of patterns) {
      const m = line.match(p);
      if (!m) continue;
      if (m[1]) {
        if (m[0].includes('{')) {
          m[1].split(',').forEach((s) => {
            const name = s.trim().split(/\s+as\s+/)[0].trim();
            if (name) symbols.add(name);
          });
        } else {
          symbols.add(m[1]);
        }
      }
    }
  }

  // Also pick up exported names from full content for TS/JS
  if (TS_EXTENSIONS.has(ext)) {
    const exportMatches = content.matchAll(
      /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
    );
    for (const m of exportMatches) symbols.add(m[1]);
  }

  return [...symbols].filter((s) => s.length > 1);
}

/** Find caller locations in high-risk files that reference a low-risk target. */
export function findBlastRadiusCallers(
  ctx: ToolContext,
  targetPath: string,
  targetSymbols: string[],
  highRiskFiles: Array<{ filePath: string; content: string }>,
  maxCallers = 3,
): ReferenceLocation[] {
  const callers: ReferenceLocation[] = [];

  for (const { filePath, content } of highRiskFiles) {
    const importsTarget = fileImportsTarget(content, filePath, targetPath);

    for (const symbol of targetSymbols) {
      const refs = findReferences(ctx, symbol, targetPath).filter(
        (r) => r.file === filePath,
      );
      if (refs.length > 0) {
        callers.push(...refs);
        continue;
      }

      if (importsTarget || content.includes(symbol)) {
        const line = findFirstSymbolLine(content, symbol);
        if (line > 0) {
          callers.push({
            file: filePath,
            line,
            snippet: snippetAroundLine(content, line),
            source: importsTarget ? 'syntactic' : 'text-match',
          });
        }
      }
    }
  }

  return dedupeReferences(callers).slice(0, maxCallers);
}

function findFirstSymbolLine(content: string, symbol: string): number {
  const re = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return 0;
}
