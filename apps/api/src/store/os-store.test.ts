import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWriteStoreFile,
  loadJsonWithBackup,
  resetStoreIoHeartbeatForTests,
  storeBackupPath,
  storeHeartbeatDir,
} from "./store-io.js";

describe("store-io atomic write + load recovery", () => {
  let dir: string;
  let storeFile: string;
  const prevBackup = process.env.ATLAS_STORE_BACKUP_INTERVAL_MS;
  const prevKeep = process.env.ATLAS_STORE_BACKUP_KEEP;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-store-io-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    storeFile = join(dir, "store.json");
    process.env.ATLAS_STORE_BACKUP_INTERVAL_MS = "1";
    process.env.ATLAS_STORE_BACKUP_KEEP = "2";
    resetStoreIoHeartbeatForTests();
  });

  afterEach(() => {
    if (prevBackup === undefined) delete process.env.ATLAS_STORE_BACKUP_INTERVAL_MS;
    else process.env.ATLAS_STORE_BACKUP_INTERVAL_MS = prevBackup;
    if (prevKeep === undefined) delete process.env.ATLAS_STORE_BACKUP_KEEP;
    else process.env.ATLAS_STORE_BACKUP_KEEP = prevKeep;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("writes primary + .bak and creates a heartbeat snapshot", () => {
    atomicWriteStoreFile(storeFile, JSON.stringify({ projects: [{ slug: "a" }] }, null, 2));
    expect(existsSync(storeFile)).toBe(true);
    expect(existsSync(storeBackupPath(storeFile))).toBe(true);
    const heartbeats = readdirSync(storeHeartbeatDir(storeFile));
    expect(heartbeats.some((n) => n.startsWith("store-") && n.endsWith(".json"))).toBe(
      true,
    );
    const parsed = JSON.parse(readFileSync(storeFile, "utf8")) as {
      projects: Array<{ slug: string }>;
    };
    expect(parsed.projects[0]?.slug).toBe("a");
  });

  it("loadJsonWithBackup recovers from .bak when primary is corrupt", () => {
    writeFileSync(
      storeBackupPath(storeFile),
      JSON.stringify({ projects: [{ slug: "from-bak" }] }),
      "utf8",
    );
    writeFileSync(storeFile, "{not-json", "utf8");
    const loaded = loadJsonWithBackup<{ projects: Array<{ slug: string }> }>(storeFile);
    expect(loaded?.projects[0]?.slug).toBe("from-bak");
  });
});
