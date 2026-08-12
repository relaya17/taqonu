import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Path of the last-known-good sibling backup (`store.json.bak`). */
export function storeBackupPath(path: string): string {
  return `${path}.bak`;
}

export function storeHeartbeatDir(path: string): string {
  return join(dirname(path), "store-backups");
}

/**
 * Atomic JSON write: temp file → rename (POSIX) / copy+unlink (Windows),
 * then refresh `.bak` for crash recovery. Optional heartbeat copies land under
 * `.atlas/store-backups/` when `ATLAS_STORE_BACKUP_INTERVAL_MS` > 0.
 */
export function atomicWriteStoreFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  try {
    try {
      renameSync(tmp, path);
    } catch {
      // Windows cannot rename over an existing file — copy then remove temp.
      copyFileSync(tmp, path);
      unlinkSync(tmp);
    }
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }

  try {
    copyFileSync(path, storeBackupPath(path));
  } catch {
    // bak is best-effort
  }

  maybeWriteHeartbeatSnapshot(path);
}

let lastHeartbeatAt = 0;

/** Test helper — reset heartbeat throttle. */
export function resetStoreIoHeartbeatForTests(): void {
  lastHeartbeatAt = 0;
}

function maybeWriteHeartbeatSnapshot(path: string): void {
  const raw = process.env.ATLAS_STORE_BACKUP_INTERVAL_MS;
  if (!raw) return;
  const intervalMs = Number(raw);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  const now = Date.now();
  if (now - lastHeartbeatAt < intervalMs) return;
  lastHeartbeatAt = now;
  try {
    const dir = storeHeartbeatDir(path);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const dest = join(dir, `${basename(path, ".json")}-${stamp}.json`);
    copyFileSync(path, dest);
    pruneHeartbeatSnapshots(dir, basename(path, ".json"));
  } catch {
    // heartbeat is best-effort
  }
}

function pruneHeartbeatSnapshots(dir: string, prefix: string): void {
  const keepRaw = process.env.ATLAS_STORE_BACKUP_KEEP;
  const keep = Number.isFinite(Number(keepRaw)) ? Math.max(1, Number(keepRaw)) : 5;
  try {
    const files = readdirSync(dir)
      .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".json"))
      .map((name) => {
        const full = join(dir, name);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of files.slice(keep)) {
      try {
        unlinkSync(stale.full);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export function readJsonFile<T extends object>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as T;
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

/** Load primary store, then `.bak`, so a torn write does not wipe state. */
export function loadJsonWithBackup<T extends object>(path: string): T | null {
  return readJsonFile<T>(path) ?? readJsonFile<T>(storeBackupPath(path));
}
