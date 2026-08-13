import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectGenomeSchema, type ProjectGenome } from "@atlas/shared";
import { atlasObserverPaths } from "../paths.js";

export interface GenomeSnapshotMeta {
  file: string;
  capturedAt: string;
  apiCount: number;
  fileCount: number;
}

export function listGenomeSnapshots(
  workspaceRoot: string,
  limit = 20,
): GenomeSnapshotMeta[] {
  const { snapshots } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(snapshots)) return [];
  try {
    const files = readdirSync(snapshots)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const full = join(snapshots, f);
        let capturedAt = f.replace(/\.json$/, "");
        let apiCount = 0;
        let fileCount = 0;
        try {
          const raw = JSON.parse(readFileSync(full, "utf8")) as unknown;
          const genome = projectGenomeSchema.safeParse(raw);
          if (genome.success) {
            capturedAt = genome.data.capturedAt;
            apiCount = genome.data.apis.length;
            fileCount = genome.data.architecture.fileCount;
          } else {
            capturedAt = new Date(statSync(full).mtimeMs).toISOString();
          }
        } catch {
          capturedAt = new Date(statSync(full).mtimeMs).toISOString();
        }
        return { file: f, capturedAt, apiCount, fileCount };
      })
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return files.slice(0, limit);
  } catch {
    return [];
  }
}

export function loadGenomeSnapshot(
  workspaceRoot: string,
  file: string,
): ProjectGenome | null {
  const { snapshots } = atlasObserverPaths(workspaceRoot);
  const safe = file.replace(/[/\\]/g, "");
  const full = join(snapshots, safe);
  if (!existsSync(full)) return null;
  try {
    return projectGenomeSchema.parse(
      JSON.parse(readFileSync(full, "utf8")) as unknown,
    );
  } catch {
    return null;
  }
}
