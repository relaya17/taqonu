import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@atlas/shared";
import {
  CloudStoreSync,
  cloudStoreEnabled,
  registerCloudStoreSync,
  type OsStoreRemote,
} from "./cloud-store-sync.js";
import { osStore, type PersistedShape } from "./os-store.js";

const dir = mkdtempSync(join(tmpdir(), "atlas-cloud-store-"));
const storeFile = join(dir, "store.json");

function project(slug: string): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    slug,
    name: slug,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  } as Project;
}

/** In-memory stand-in for the Supabase row, shared like two instances would. */
class MemoryRemote implements OsStoreRemote {
  row: { version: number; shape: PersistedShape } | null = null;
  failWrites = false;
  async readVersion() {
    return this.row?.version ?? null;
  }
  async read() {
    return this.row ? structuredClone(this.row) : null;
  }
  async insert(shape: PersistedShape) {
    if (this.failWrites) throw new Error("network down");
    if (this.row) return false;
    this.row = { version: 1, shape: structuredClone(shape) };
    return true;
  }
  async compareAndSwap(expected: number, shape: PersistedShape) {
    if (this.failWrites) throw new Error("network down");
    if (!this.row || this.row.version !== expected) return false;
    this.row = { version: expected + 1, shape: structuredClone(shape) };
    return true;
  }
}

const liveEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
};

beforeEach(() => {
  process.env.ATLAS_STORE_PATH = storeFile;
  delete process.env.ATLAS_STORE_BACKEND;
  osStore.setDurableBackend("cloud");
  osStore.replaceWithShape(null);
});

afterEach(() => {
  osStore.setDurableBackend("file");
  osStore.replaceWithShape(null);
  delete process.env.ATLAS_STORE_PATH;
  delete process.env.ATLAS_STORE_BACKEND;
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cloudStoreEnabled", () => {
  it("stays on the local file outside Vercel unless asked", () => {
    vi.stubEnv("VERCEL", "");
    expect(cloudStoreEnabled(liveEnv)).toBe(false);
    process.env.ATLAS_STORE_BACKEND = "supabase";
    expect(cloudStoreEnabled(liveEnv)).toBe(true);
  });

  it("turns on automatically on Vercel with live Supabase, and can be forced off", () => {
    vi.stubEnv("VERCEL", "1");
    expect(cloudStoreEnabled(liveEnv)).toBe(true);
    expect(
      cloudStoreEnabled({ ...liveEnv, SUPABASE_SERVICE_ROLE_KEY: "replace-me" }),
    ).toBe(false);
    process.env.ATLAS_STORE_BACKEND = "file";
    expect(cloudStoreEnabled(liveEnv)).toBe(false);
  });
});

describe("CloudStoreSync", () => {
  it("cloud persist() never touches the filesystem; flush creates version 1", async () => {
    const remote = new MemoryRemote();
    const sync = new CloudStoreSync(remote);
    await sync.pull();
    osStore.upsertProject(project("alpha"));
    expect(existsSync(storeFile)).toBe(false);
    expect(osStore.isDirty()).toBe(true);

    await sync.flush();
    expect(osStore.isDirty()).toBe(false);
    expect(remote.row?.version).toBe(1);
    expect(remote.row?.shape.projects.map((p) => p.slug)).toEqual(["alpha"]);
  });

  it("reloads a newer snapshot written by another instance", async () => {
    const remote = new MemoryRemote();
    const a = new CloudStoreSync(remote);
    await a.pull();
    osStore.upsertProject(project("alpha"));
    await a.flush();
    const instanceAMemory = structuredClone(remote.row!.shape);

    // Another instance (fresh memory) picks it up and adds a project.
    osStore.replaceWithShape(null);
    const b = new CloudStoreSync(remote);
    await b.pull();
    expect(osStore.getProjectBySlug("alpha")).toBeDefined();
    osStore.upsertProject(project("beta"));
    await b.flush();
    expect(remote.row?.version).toBe(2);

    // Back on instance A (memory still at version 1): next request reloads.
    osStore.replaceWithShape(instanceAMemory);
    expect(osStore.getProjectBySlug("beta")).toBeUndefined();
    await a.pull();
    expect(osStore.listProjects().map((p) => p.slug).sort()).toEqual(["alpha", "beta"]);
    expect(a.currentVersion()).toBe(2);
  });

  it("does not discard unflushed local changes on reload", async () => {
    const remote = new MemoryRemote();
    const sync = new CloudStoreSync(remote);
    await sync.pull();
    osStore.upsertProject(project("alpha"));
    await sync.flush();
    osStore.upsertProject(project("pending"));
    remote.row = { version: 9, shape: { ...remote.row!.shape, projects: [] } };
    await sync.pull();
    expect(osStore.getProjectBySlug("pending")).toBeDefined();
  });

  it("on a version conflict the latest writer wins and the conflict is logged", async () => {
    const remote = new MemoryRemote();
    const warn = vi.fn();
    const sync = new CloudStoreSync(remote, { info: vi.fn(), warn });
    await sync.pull();
    osStore.upsertProject(project("alpha"));
    await sync.flush();
    remote.row = { ...remote.row!, version: 5 };
    osStore.upsertProject(project("beta"));
    await sync.flush();
    expect(remote.row?.version).toBe(6);
    expect(remote.row?.shape.projects.map((p) => p.slug)).toEqual(["alpha", "beta"]);
    expect(warn).toHaveBeenCalledWith("store_cloud_conflict", expect.any(Object));
  });

  it("replaceWithShape drops every field of the previous snapshot", () => {
    osStore.upsertProject(project("old"));
    osStore.setMeta("k", "v");
    osStore.replaceWithShape(null);
    expect(osStore.listProjects()).toEqual([]);
    expect(osStore.toShape().meta).toEqual({});
  });
});

describe("registerCloudStoreSync request lifecycle", () => {
  async function appWith(remote: MemoryRemote) {
    const app = Fastify();
    registerCloudStoreSync(app, liveEnv, undefined, remote);
    app.post("/write", async () => {
      osStore.upsertProject(project("from-route"));
      return { ok: true };
    });
    app.get("/read", async () => ({ count: osStore.listProjects().length }));
    await app.ready();
    return app;
  }

  it("saves a write to Supabase before answering", async () => {
    const remote = new MemoryRemote();
    const app = await appWith(remote);
    const res = await app.inject({ method: "POST", url: "/write" });
    expect(res.statusCode).toBe(200);
    expect(remote.row?.shape.projects.map((p) => p.slug)).toEqual(["from-route"]);
    await app.close();
  });

  it("answers 503 instead of 200 when the write could not be saved", async () => {
    const remote = new MemoryRemote();
    remote.failWrites = true;
    const app = await appWith(remote);
    const res = await app.inject({ method: "POST", url: "/write" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("INTEGRATION_ERROR");
    await app.close();
  });

  it("is a no-op registration when cloud mode is off", () => {
    vi.stubEnv("VERCEL", "");
    const app = Fastify();
    expect(registerCloudStoreSync(app, liveEnv)).toBeNull();
    osStore.setDurableBackend("file");
  });
});
