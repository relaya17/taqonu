export type StudioGitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "other";

export interface StudioGitChange {
  readonly path: string;
  readonly xy: string;
  readonly kind: StudioGitChangeKind;
}

export function porcelainKind(xy: string): StudioGitChangeKind {
  if (xy === "??") return "untracked";
  if (xy.includes("R") || xy.includes("C")) return "renamed";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "added";
  if (xy.includes("M") || xy.includes("U")) return "modified";
  return "other";
}

/** Parse `git status --porcelain` stdout. Read-only; never invents commits. */
export function parseGitPorcelain(stdout: string): StudioGitChange[] {
  const changes: StudioGitChange[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (raw.length < 4) continue;
    const xy = raw.slice(0, 2);
    const rest = raw.slice(3).trim();
    if (!rest) continue;
    const arrow = rest.indexOf(" -> ");
    const path = arrow >= 0 ? rest.slice(arrow + 4).trim() : rest;
    if (!path) continue;
    changes.push({ path, xy, kind: porcelainKind(xy) });
  }
  return changes;
}

export function isGitStatusResult(result: {
  commandId?: string | null;
  stdout?: string;
} | null): boolean {
  return Boolean(result && result.commandId === "git.status");
}

export function isGitBranchResult(result: {
  commandId?: string | null;
} | null): boolean {
  return Boolean(result && result.commandId === "git.branch");
}

export function isGitDiffResult(result: {
  commandId?: string | null;
} | null): boolean {
  return Boolean(result && result.commandId === "git.diff");
}

export function parseGitBranchName(stdout: string): string {
  return stdout.trim().split(/\r?\n/)[0] ?? "";
}
