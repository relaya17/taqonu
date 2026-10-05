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
  loadJsonWithBackupProvenance,
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

describe("store-io load provenance (additive; loadJsonWithBackup behavior unchanged)", () => {
  let dir: string;
  let storeFile: string;

  beforeEach(() => {
    dir = join(tmpdir(), `atlas-store-prov-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    storeFile = join(dir, "store.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("PRIMARY: a readable primary file", () => {
    writeFileSync(storeFile, JSON.stringify({ projects: [{ slug: "p" }] }), "utf8");
    const result = loadJsonWithBackupProvenance<{ projects: Array<{ slug: string }> }>(storeFile);
    expect(result.source).toBe("PRIMARY");
    expect(result.value?.projects[0]?.slug).toBe("p");
  });

  it("PRIMARY wins over a different .bak", () => {
    writeFileSync(storeFile, JSON.stringify({ projects: [{ slug: "primary" }] }), "utf8");
    writeFileSync(storeBackupPath(storeFile), JSON.stringify({ projects: [{ slug: "bak" }] }), "utf8");
    const result = loadJsonWithBackupProvenance<{ projects: Array<{ slug: string }> }>(storeFile);
    expect(result.source).toBe("PRIMARY");
    expect(result.value?.projects[0]?.slug).toBe("primary");
  });

  it("BACKUP: a corrupt primary recovered from .bak is never reported as PRIMARY", () => {
    writeFileSync(storeBackupPath(storeFile), JSON.stringify({ projects: [{ slug: "from-bak" }] }), "utf8");
    writeFileSync(storeFile, "{not-json", "utf8");
    const result = loadJsonWithBackupProvenance<{ projects: Array<{ slug: string }> }>(storeFile);
    expect(result.source).toBe("BACKUP");
    expect(result.value?.projects[0]?.slug).toBe("from-bak");
  });

  it("BACKUP: a missing primary recovered from .bak", () => {
    writeFileSync(storeBackupPath(storeFile), JSON.stringify({ projects: [] }), "utf8");
    expect(loadJsonWithBackupProvenance(storeFile).source).toBe("BACKUP");
  });

  it("ABSENT: neither file exists (a fresh install), distinct from unusable files", () => {
    expect(loadJsonWithBackupProvenance(storeFile)).toEqual({ value: null, source: "ABSENT" });
  });

  it("MALFORMED: a primary that exists but is not usable JSON and no usable backup", () => {
    writeFileSync(storeFile, "{not-json", "utf8");
    expect(loadJsonWithBackupProvenance(storeFile)).toEqual({ value: null, source: "MALFORMED" });
  });

  it("MALFORMED: JSON that is not an object", () => {
    writeFileSync(storeFile, "42", "utf8");
    expect(loadJsonWithBackupProvenance(storeFile).source).toBe("MALFORMED");
  });

  it("MALFORMED: a missing primary with a corrupt .bak", () => {
    writeFileSync(storeBackupPath(storeFile), "{not-json", "utf8");
    expect(loadJsonWithBackupProvenance(storeFile).source).toBe("MALFORMED");
  });

  it("UNAVAILABLE: a primary that exists but cannot be read (a directory)", () => {
    mkdirSync(storeFile);
    expect(loadJsonWithBackupProvenance(storeFile)).toEqual({ value: null, source: "UNAVAILABLE" });
  });

  it("returns the same value as loadJsonWithBackup in every case", () => {
    writeFileSync(storeBackupPath(storeFile), JSON.stringify({ projects: [{ slug: "b" }] }), "utf8");
    writeFileSync(storeFile, "{not-json", "utf8");
    expect(loadJsonWithBackupProvenance(storeFile).value).toEqual(loadJsonWithBackup(storeFile));
    rmSync(storeFile);
    rmSync(storeBackupPath(storeFile));
    expect(loadJsonWithBackupProvenance(storeFile).value).toEqual(loadJsonWithBackup(storeFile));
  });
});

describe("osStore.getLoadSource (retained load provenance)", () => {
  let dir: string;
  let storeFile: string;
  const prevPath = process.env.ATLAS_STORE_PATH;
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;

  beforeEach(() => {
    dir = join(tmpdir(), `atlas-store-src-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    storeFile = join(dir, "store.json");
    process.env.ATLAS_STORE_PATH = storeFile;
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  });

  afterEach(async () => {
    const { osStore } = await import("./os-store.js");
    osStore.unloadForTests();
    if (prevPath === undefined) delete process.env.ATLAS_STORE_PATH;
    else process.env.ATLAS_STORE_PATH = prevPath;
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    rmSync(dir, { recursive: true, force: true });
  });

  async function freshStore() {
    const { osStore } = await import("./os-store.js");
    osStore.unloadForTests();
    return osStore;
  }

  it("reports PRIMARY, ABSENT, BACKUP, MALFORMED and UNAVAILABLE from the real files", async () => {
    const store = await freshStore();
    expect(store.getLoadSource()).toBe("ABSENT");

    writeFileSync(storeFile, JSON.stringify({ projects: [], meta: { k: "v" } }), "utf8");
    store.unloadForTests();
    expect(store.getLoadSource()).toBe("PRIMARY");
    expect(store.getMeta("k")).toBe("v");

    writeFileSync(storeBackupPath(storeFile), JSON.stringify({ projects: [], meta: { k: "from-bak" } }), "utf8");
    writeFileSync(storeFile, "{not-json", "utf8");
    store.unloadForTests();
    expect(store.getLoadSource()).toBe("BACKUP");
    expect(store.getMeta("k")).toBe("from-bak");

    rmSync(storeBackupPath(storeFile));
    store.unloadForTests();
    expect(store.getLoadSource()).toBe("MALFORMED");

    rmSync(storeFile);
    mkdirSync(storeFile);
    store.unloadForTests();
    expect(store.getLoadSource()).toBe("UNAVAILABLE");
  });

  it("a cloud snapshot is the single durable source: PRIMARY with a shape, ABSENT without one", async () => {
    const store = await freshStore();
    store.replaceWithShape({ projects: [] } as never);
    expect(store.getLoadSource()).toBe("PRIMARY");
    store.replaceWithShape(null);
    expect(store.getLoadSource()).toBe("ABSENT");
  });

  it("the test-only blank store is ABSENT", async () => {
    const store = await freshStore();
    store.resetInMemoryForTests();
    expect(store.getLoadSource()).toBe("ABSENT");
  });
});
