import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { memorySchema, projectSchema, STUB_OWNER_ID } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { registerAgentRoutes } = await import("./agent.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

let app: FastifyInstance;

/**
 * A registered project gives collectEvidenceRefs() a non-empty
 * `portfolio-registry` ref, so the route's epistemicLabel resolves to
 * PROPOSED instead of INSUFFICIENT_EVIDENCE — needed for the persist-memory
 * path (`persistArletosAgentMemory`) to actually run in tests below.
 */
function seedProject(): void {
  const now = new Date().toISOString();
  osStore.upsertProject(
    projectSchema.parse({
      id: crypto.randomUUID(),
      slug: `demo-${Math.random().toString(36).slice(2, 8)}`,
      name: "Demo",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    }),
  );
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerAgentRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/v1/agent/runs", () => {
  it("400s with VALIDATION_ERROR when userRequest is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("400s when userRequest exceeds the 10000-char limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "x".repeat(10001) },
    });
    expect(res.statusCode).toBe(400);
  });

  // NOTE: createAgentRunSchema's aiProviderId enum only lists the 12
  // "agent"-kind catalog entries — the two "assist"-kind ids
  // (local-checklist, gpt-4o-vision) aren't in it at all. So the route's own
  // `catalog.kind === "assist"` guard (with its friendlier "Provider is
  // assist-only" message) is unreachable dead code: any assist-only id gets
  // rejected by the Zod schema first, as a generic VALIDATION_ERROR.
  it("400s for an assist-only aiProviderId — rejected by the Zod enum before the route's own assist-only guard ever runs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "hello", aiProviderId: "local-checklist" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("201s for a normal READ request on the free included provider and returns a well-formed run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "what is the current project status?" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.id).toBeDefined();
    expect(body.run.userRequest).toBe("what is the current project status?");
    expect(body.catalog.id).toBe("arletos-included");
    expect(body.authorizationPreview).toBeDefined();
  });

  it("appends a WRITE-approval-gated note when the request implies a write change", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "please commit and push this fix to the repo" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.status).toBe("AWAITING_APPROVAL");
    expect(body.run.answer).toMatch(/approval-gated/);
  });

  it("GET /api/v1/agent/runs lists previously created runs", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/agent/runs" });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("400s when the request body isn't valid JSON-shaped for the schema (wrong type)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: 12345 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("never persists a raw secret from userRequest into learned Memory — redaction bug fix", async () => {
    seedProject();
    const rawSecret = "sk-live-51H8example1234567890abcdef";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: {
        userRequest: `please remember my api_key=${rawSecret} for later, what is the project status?`,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Sanity: this exercise actually reached the persist-memory path.
    expect(body.learnedMemoryId).toBeTruthy();

    const learned = osStore
      .getMemories("global", STUB_OWNER_ID)
      .find((m) => m.id === body.learnedMemoryId);
    expect(learned).toBeDefined();
    expect(learned?.statement).not.toContain(rawSecret);
    expect(learned?.evidence.every((e) => !e.excerpt?.includes(rawSecret))).toBe(
      true,
    );
    // The redacted marker should show up in its place.
    expect(
      learned?.statement.includes("[REDACTED_SECRET]") ||
        learned?.evidence.some((e) => e.excerpt?.includes("[REDACTED_SECRET]")),
    ).toBe(true);
  });

  it("scopes buildMemoryContext to the resolved ownerId — another owner's memory in the same project never surfaces (P0 tenant-isolation fix)", async () => {
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject(
      projectSchema.parse({
        id: projectId,
        slug: `tenant-check-${Math.random().toString(36).slice(2, 8)}`,
        name: "Tenant Check",
        description: null,
        status: "ACTIVE",
        techStack: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
    const otherOwnerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    function projectMemory(statement: string, ownerId: string) {
      return memorySchema.parse({
        id: crypto.randomUUID(),
        ownerId,
        type: "LESSON",
        projectId,
        statement,
        reason: ["test"],
        status: "ACTIVE",
        confidence: 0.7,
        category: "GENERATED_REASONING",
        epistemicState: "OBSERVED",
        observationMode: "OBSERVED",
        source: "test",
        sourceType: "SYSTEM",
        sourceId: null,
        evidence: [],
        supersededBy: null,
        validFrom: now,
        validUntil: null,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "test",
        scope: "PROJECT",
        priority: "MEDIUM",
      });
    }
    osStore.addMemory(projectMemory("stub owner's project memory", STUB_OWNER_ID));
    osStore.addMemory(projectMemory("other tenant's project memory", otherOwnerId));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agent/runs",
      payload: { userRequest: "project memory", projectId },
    });
    expect(res.statusCode).toBe(201);
    const statements = res
      .json()
      .memoryContext.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("stub owner's project memory");
    expect(statements).not.toContain("other tenant's project memory");
  });
});
