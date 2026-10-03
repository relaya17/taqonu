/**
 * Unified diff parsing for Studio's per-file hunk navigation (Next/Previous
 * Change). Input is the stdout of the governed `git.diff` command — read
 * only, never executes git itself. Paths with spaces or exotic quoting are
 * a known limitation of the plain `diff --git a/x b/x` header match.
 */
export interface StudioDiffHunk {
  readonly path: string;
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Working-tree (new-file) line numbers added or changed in this hunk. */
  readonly changedLines: readonly number[];
}

export interface StudioDiffFile {
  readonly path: string;
  readonly hunks: readonly StudioDiffHunk[];
}

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diffText: string): StudioDiffFile[] {
  const files: StudioDiffFile[] = [];
  let currentPath: string | null = null;
  let currentHunks: StudioDiffHunk[] = [];
  let hunk: {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    changedLines: number[];
  } | null = null;
  let newLine = 0;

  const flushHunk = () => {
    if (hunk && currentPath) currentHunks.push({ path: currentPath, ...hunk });
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (currentPath) files.push({ path: currentPath, hunks: currentHunks });
    currentHunks = [];
  };

  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = FILE_HEADER.exec(line);
    if (fileMatch) {
      flushFile();
      currentPath = fileMatch[2] ?? fileMatch[1] ?? null;
      continue;
    }
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      flushHunk();
      const newStart = Number(hunkMatch[3]);
      newLine = newStart;
      hunk = {
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart,
        newLines: Number(hunkMatch[4] ?? "1"),
        changedLines: [],
      };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunk.changedLines.push(newLine);
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Removed line: does not exist in the new file, counter stays put.
    } else if (line.startsWith(" ") || line.length === 0) {
      newLine += 1;
    }
  }
  flushFile();
  return files;
}

export function studioDiffFileFor(
  files: readonly StudioDiffFile[],
  path: string,
): StudioDiffFile | null {
  return files.find((file) => file.path === path) ?? null;
}

/** Flattened, de-duplicated, sorted new-file line numbers for a gutter marker. */
export function studioDiffChangedLines(file: StudioDiffFile | null): number[] {
  if (!file) return [];
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.changedLines) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}
