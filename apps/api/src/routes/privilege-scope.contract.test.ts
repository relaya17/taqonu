/**
 * R07 — written admin vs operator privilege contract.
 *
 * F17 / F39 remain INTENTIONAL / NOT A GAP. This file locks the actual
 * behavior; it does not "clean up" instance-admin all-owner read.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AtlasError,
  isControlPlaneRole,
  principalKindFromRole,
  type AuthUser,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-privilege-scope-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";
process.env.ATLAS_AUDIT_LOG_PATH = join(tmpDir, "audit.ndjson");

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

const {
  requireUser,
  requireAdmin,
  requireOperator,
  requireOwner,
} = await import("../middleware/auth-guards.js");
const { isPublicAtlasRoute } = await import("../middleware/public-routes.js");
const { canReadProjectScoped, bindProjectOwner } = await import(
  "../services/project-access.js"
);
const { registerMemoryRoutes } = await import("./memory.js");
const { registerAuditRoutes } = await import("./audit.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

function user(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    displayName: "User",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const customerUser = user();
const otherUser = user({
  id: "22222222-2222-4222-8222-222222222222",
  email: "other@example.com",
});
const customerAdmin = user({
  id: "33333333-3333-4333-8333-333333333333",
  email: "admin@example.com",
  role: "admin",
});
const operator = user({
  id: "44444444-4444-4444-8444-444444444444",
  email: "operator@example.com",
  role: "operator",
});
const owner = user({
  id: "55555555-5555-4555-8555-555555555555",
  email: "owner@example.com",
  role: "owner",
});

function seedMemory(ownerId: string, statement: string): void {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId: null,
    statement,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: "seed",
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
    scope: "GLOBAL",
    priority: "MEDIUM",
  });
}

describe("R07 privilege / operator contract", () => {
  const fakeApp = {} as FastifyInstance;
  const fakeRequest = {} as FastifyRequest;
  let memoryApp: FastifyInstance;
  let auditApp: FastifyInstance;

  beforeAll(async () => {
    memoryApp = await buildRouteTestApp(registerMemoryRoutes, {
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    });
    auditApp = await buildRouteTestApp(registerAuditRoutes);
    seedMemory(customerUser.id, "tenant-a memory");
    seedMemory(otherUser.id, "tenant-b memory");
    bindProjectOwner("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerUser.id, "claimed");
  });

  afterAll(async () => {
    await memoryApp.close();
    await auditApp.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    getRequestUser.mockReset();
  });

  describe("who is an admin vs operator", () => {
    it("maps roles to principal kinds without collapsing admin into operator", () => {
      expect(principalKindFromRole("admin")).toBe("CUSTOMER_ADMIN");
      expect(principalKindFromRole("operator")).toBe("ATLAS_OPERATOR");
      expect(principalKindFromRole("owner")).toBe("ATLAS_OWNER");
      expect(principalKindFromRole("user")).toBe("CUSTOMER_USER");
      expect(isControlPlaneRole("admin")).toBe(false);
      expect(isControlPlaneRole("operator")).toBe(true);
      expect(isControlPlaneRole("owner")).toBe(true);
    });

    it("requireAdmin is admin OR operator OR owner; requireOperator excludes customer admin", async () => {
      getRequestUser.mockReturnValue(null);
      await expect(requireUser(fakeApp, fakeRequest)).rejects.toBeInstanceOf(
        AtlasError,
      );

      getRequestUser.mockReturnValue(customerUser);
      await expect(requireAdmin(fakeApp, fakeRequest)).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(requireOperator(fakeApp, fakeRequest)).rejects.toMatchObject({
        statusCode: 403,
      });

      getRequestUser.mockReturnValue(customerAdmin);
      expect(await requireAdmin(fakeApp, fakeRequest)).toEqual(customerAdmin);
      await expect(requireOperator(fakeApp, fakeRequest)).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(requireOwner(fakeApp, fakeRequest)).rejects.toMatchObject({
        statusCode: 403,
      });

      getRequestUser.mockReturnValue(operator);
      expect(await requireAdmin(fakeApp, fakeRequest)).toEqual(operator);
      expect(await requireOperator(fakeApp, fakeRequest)).toEqual(operator);
      await expect(requireOwner(fakeApp, fakeRequest)).rejects.toMatchObject({
        statusCode: 403,
      });

      getRequestUser.mockReturnValue(owner);
      expect(await requireAdmin(fakeApp, fakeRequest)).toEqual(owner);
      expect(await requireOperator(fakeApp, fakeRequest)).toEqual(owner);
      expect(await requireOwner(fakeApp, fakeRequest)).toEqual(owner);
    });
  });

  describe("instance-wide vs tenant-scoped (F17 / F18 / F39)", () => {
    it("F17 INTENTIONAL: instance-admin reads all owners' memories", async () => {
      getRequestUser.mockReturnValue(customerAdmin);
      const res = await memoryApp.inject({ method: "GET", url: "/api/v1/memory" });
      expect(res.statusCode).toBe(200);
      const statements = res
        .json()
        .items.map((item: { statement: string }) => item.statement);
      expect(statements).toContain("tenant-a memory");
      expect(statements).toContain("tenant-b memory");
    });

    it("memory unscope is admin-only: operator stays tenant-scoped (F18)", async () => {
      seedMemory(operator.id, "operator-own memory");
      getRequestUser.mockReturnValue(operator);
      const res = await memoryApp.inject({ method: "GET", url: "/api/v1/memory" });
      expect(res.statusCode).toBe(200);
      const statements = res
        .json()
        .items.map((item: { statement: string }) => item.statement);
      expect(statements).toContain("operator-own memory");
      expect(statements).not.toContain("tenant-a memory");
      expect(statements).not.toContain("tenant-b memory");
    });

    it("ordinary user remains tenant-scoped on memory", async () => {
      getRequestUser.mockReturnValue(customerUser);
      const res = await memoryApp.inject({ method: "GET", url: "/api/v1/memory" });
      expect(res.statusCode).toBe(200);
      const statements = res
        .json()
        .items.map((item: { statement: string }) => item.statement);
      expect(statements).toContain("tenant-a memory");
      expect(statements).not.toContain("tenant-b memory");
    });

    it("project unscope is admin OR operator OR owner (F18 documented inconsistency)", () => {
      const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      expect(canReadProjectScoped(customerUser, projectId)).toBe(true);
      expect(canReadProjectScoped(otherUser, projectId)).toBe(false);
      expect(canReadProjectScoped(customerAdmin, projectId)).toBe(true);
      expect(canReadProjectScoped(operator, projectId)).toBe(true);
      expect(canReadProjectScoped(owner, projectId)).toBe(true);
    });

    it("F39 INTENTIONAL: audit GET is requireAdmin and instance-wide", async () => {
      getRequestUser.mockReturnValue(null);
      expect(
        (await auditApp.inject({ method: "GET", url: "/api/v1/audit" })).statusCode,
      ).toBe(401);

      getRequestUser.mockReturnValue(customerUser);
      expect(
        (await auditApp.inject({ method: "GET", url: "/api/v1/audit" })).statusCode,
      ).toBe(403);

      getRequestUser.mockReturnValue(customerAdmin);
      expect(
        (await auditApp.inject({ method: "GET", url: "/api/v1/audit" })).statusCode,
      ).toBe(200);

      getRequestUser.mockReturnValue(operator);
      expect(
        (await auditApp.inject({ method: "GET", url: "/api/v1/audit" })).statusCode,
      ).toBe(200);
    });
  });

  describe("public-route honesty for privileged surfaces", () => {
    it("does not put memory, audit, or kernel lessons on the public allow-list", () => {
      expect(isPublicAtlasRoute("GET", "/api/v1/memory")).toBe(false);
      expect(isPublicAtlasRoute("GET", "/api/v1/audit")).toBe(false);
      expect(isPublicAtlasRoute("GET", "/api/v1/kernel/memory/lessons")).toBe(
        false,
      );
      expect(isPublicAtlasRoute("GET", "/api/v1/projects")).toBe(false);
    });
  });
});
