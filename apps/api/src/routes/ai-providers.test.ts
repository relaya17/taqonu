import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { STUB_OWNER_ID } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-ai-providers-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// Defect #2 regression coverage. ai-providers.ts resolves tenant ownership
// via `resolveCloudIdentity` (not `getRequestUser`/`requireUser` — this
// route has no hard sign-in gate, matching billing.test.ts's stubbing
// pattern for the same reason), so only that is stubbed here. Each test
// controls exactly which ownerId the route sees, without a real
// Supabase/local-session cookie.
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

const { registerAiProviderRoutes } = await import("./ai-providers.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";

function identityFor(ownerId: string) {
  return {
    ownerId,
    userAccessToken: null,
    setCookie: null,
    source: null,
  };
}

function makeProject(): string {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: "Test Project",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function seedMemory(input: {
  ownerId: string;
  source: string;
  projectId: string | null;
}) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    type: "LESSON",
    projectId: input.projectId,
    statement: `seed memory for ${input.ownerId}`,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: input.source,
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
    scope: input.projectId ? "PROJECT" : "GLOBAL",
    priority: "MEDIUM",
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  // Force `isLiveSupabase` false so the route's `cloudAuth` field never
  // attempts a real Supabase network call during tests.
  app = await buildRouteTestApp(registerAiProviderRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
  });

  const projectA = makeProject();
  const projectB = makeProject();

  // Owner A: 2 arletos-agent memories (one project-scoped, one global) +
  // 1 memory from an unrelated source that must never be counted.
  seedMemory({ ownerId: OWNER_A, source: "arletos-agent", projectId: projectA });
  seedMemory({ ownerId: OWNER_A, source: "arletos-agent", projectId: null });
  seedMemory({ ownerId: OWNER_A, source: "conversation", projectId: projectA });

  // Owner B: 1 arletos-agent memory, in a *different* project.
  seedMemory({ ownerId: OWNER_B, source: "arletos-agent", projectId: projectB });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/v1/ai/providers — Defect #2 regression", () => {
  it("public provider catalog remains reachable without a session (no 401)", async () => {
    resolveCloudIdentity.mockResolvedValue(identityFor(STUB_OWNER_ID));
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/providers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    // Catalog fields unrelated to memory are untouched by the fix.
    const arletos = body.items.find((p: { id: string }) => p.id === "arletos-included");
    expect(arletos).toBeDefined();
    expect(arletos.available).toBe(true);
    expect(arletos.priceLabel).toBe("free");
  });

  it("anonymous/stub-owner request does not receive the cross-tenant sum", async () => {
    resolveCloudIdentity.mockResolvedValue(identityFor(STUB_OWNER_ID));
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/providers" });
    const body = res.json();
    // Neither seeded owner is the stub owner, so the count must be 0 —
    // never 3 (owner A's 2 + owner B's 1), which is what the pre-fix
    // unscoped `getMemories(p.id)` loop would have returned to *any*
    // caller, authenticated or not.
    expect(body.arletosMemoryCount).toBe(0);
  });

  it("tenant A sees only tenant A's arletos-agent memory count, never tenant B's", async () => {
    resolveCloudIdentity.mockResolvedValue(identityFor(OWNER_A));
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/providers" });
    const body = res.json();
    expect(body.arletosMemoryCount).toBe(2);
    const arletos = body.items.find((p: { id: string }) => p.id === "arletos-included");
    expect(arletos.memoryCount).toBe(2);
  });

  it("tenant B sees only tenant B's arletos-agent memory count, never tenant A's", async () => {
    resolveCloudIdentity.mockResolvedValue(identityFor(OWNER_B));
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/providers" });
    const body = res.json();
    expect(body.arletosMemoryCount).toBe(1);
  });

  it("memories from a non-arletos-agent source are never counted", async () => {
    // Owner A also has a "conversation"-sourced memory (seeded above);
    // confirm it never inflates the count beyond the 2 arletos-agent ones.
    resolveCloudIdentity.mockResolvedValue(identityFor(OWNER_A));
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/providers" });
    const body = res.json();
    expect(body.arletosMemoryCount).toBe(2);
  });

  it("GET /api/v1/ai/providers/:id is unaffected by the fix", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ai/providers/arletos-included",
    });
    expect(res.statusCode).toBe(200);
  });
});
