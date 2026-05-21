/**
 * Parse a unified diff to determine which new-file line numbers are valid
 * targets for inline PR review comments (i.e. lines that appear in diff hunks).
 *
 * Returns Map<filename, Set<valid line numbers on the RIGHT/new side>>.
 */
export function parseDiffForCommentTargets(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const fileChunks = diff.split(/(?=^diff --git )/m);

  for (const chunk of fileChunks) {
    if (!chunk.startsWith('diff --git ')) continue;

    const fileMatch = chunk.match(/^diff --git a\/.+? b\/(.+)$/m);
    if (!fileMatch) continue;
    const filename = fileMatch[1];

    const validLines = new Set<number>();
    const lines = chunk.split('\n');
    let newLineNum = 0;
    let inHunk = false;

    for (const line of lines) {
      const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkHeader) {
        newLineNum = parseInt(hunkHeader[1], 10);
        inHunk = true;
        continue;
      }

      if (!inHunk) continue;
      if (line.startsWith('diff --git ')) break;

      if (line.startsWith('+')) {
        validLines.add(newLineNum);
        newLineNum++;
      } else if (line.startsWith('-')) {
        // deleted line — no line number in the new file
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file"
      } else {
        // context line (space-prefixed) or blank context
        validLines.add(newLineNum);
        newLineNum++;
      }
    }

    if (validLines.size > 0) {
      result.set(filename, validLines);
    }
  }

  return result;
}
