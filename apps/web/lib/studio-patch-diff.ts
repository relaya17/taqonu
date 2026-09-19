export type PatchFileAction = "add" | "modify" | "delete";

export interface PatchFileChangeLike {
  readonly path: string;
  readonly action: string;
  readonly summary?: string;
  readonly unifiedDiff?: string;
  readonly afterContent?: string;
}

export type StudioDiffLineKind = "hunk" | "add" | "del" | "ctx" | "meta";

export interface StudioDiffLine {
  readonly kind: StudioDiffLineKind;
  readonly text: string;
}

export interface StudioPatchFileDiff {
  readonly path: string;
  readonly action: PatchFileAction;
  readonly summary: string;
  readonly lines: readonly StudioDiffLine[];
  readonly additions: number;
  readonly deletions: number;
}

export interface StudioPatchChangeSet {
  readonly files: readonly StudioPatchFileDiff[];
  readonly additions: number;
  readonly deletions: number;
}

function asAction(value: string): PatchFileAction {
  if (value === "add" || value === "delete") return value;
  return "modify";
}

export function parseUnifiedDiff(diff: string): StudioDiffLine[] {
  const lines: StudioDiffLine[] = [];
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      lines.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ")) {
      lines.push({ kind: "meta", text: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      lines.push({ kind: "meta", text: raw });
    } else {
      lines.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return lines;
}

function linesForChange(change: PatchFileChangeLike): StudioDiffLine[] {
  if (change.unifiedDiff && change.unifiedDiff.length > 0) {
    return parseUnifiedDiff(change.unifiedDiff);
  }
  if (change.afterContent && change.afterContent.length > 0) {
    return change.afterContent.split("\n").map((text) => ({
      kind: "add" as const,
      text,
    }));
  }
  return [];
}

export function studioPatchChangeSet(
  filesChanged: readonly PatchFileChangeLike[],
): StudioPatchChangeSet {
  const files = filesChanged.map((change) => {
    const lines = linesForChange(change);
    const additions = lines.filter((line) => line.kind === "add").length;
    const deletions = lines.filter((line) => line.kind === "del").length;
    return {
      path: change.path,
      action: asAction(change.action),
      summary: change.summary ?? "",
      lines,
      additions,
      deletions,
    };
  });
  return {
    files,
    additions: files.reduce((n, file) => n + file.additions, 0),
    deletions: files.reduce((n, file) => n + file.deletions, 0),
  };
}
