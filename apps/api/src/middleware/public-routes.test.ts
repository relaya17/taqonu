import { describe, expect, it } from "vitest";
import { isPublicAtlasRoute } from "./public-routes.js";

describe("isPublicAtlasRoute (ADR-021 allow-list)", () => {
  it("allows health and auth handshake", () => {
    expect(isPublicAtlasRoute("GET", "/health")).toBe(true);
    expect(isPublicAtlasRoute("GET", "/api/v1/health")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/auth/login")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/github/webhooks")).toBe(true);
    expect(isPublicAtlasRoute("GET", "/api/v1/knowledge/refresh")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/knowledge/refresh")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/governance/lifecycle/handoff")).toBe(
      true,
    );
    expect(isPublicAtlasRoute("POST", "/api/v1/gateway/fulfill")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/approvals/verify-atlas-self")).toBe(
      true,
    );
    expect(
      isPublicAtlasRoute("POST", "/api/v1/approvals/atlas-self/control-request"),
    ).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/audit/cp-import")).toBe(true);
  });

  it("denies tenant and studio reads", () => {
    expect(isPublicAtlasRoute("GET", "/api/v1/studio/tree")).toBe(false);
    expect(isPublicAtlasRoute("GET", "/api/v1/memory")).toBe(false);
    expect(isPublicAtlasRoute("POST", "/api/v1/code/analyze")).toBe(false);
    expect(isPublicAtlasRoute("GET", "/api/v1/admin/command-center")).toBe(false);
    expect(isPublicAtlasRoute("GET", "/api/v1/platform/studio-supervision")).toBe(
      false,
    );
    expect(isPublicAtlasRoute("GET", "/api/v1/graph/nodes")).toBe(false);
    expect(isPublicAtlasRoute("GET", "/api/v1/approvals")).toBe(false);
    expect(isPublicAtlasRoute("POST", "/api/v1/approvals/x/decide")).toBe(false);
    expect(
      isPublicAtlasRoute("POST", "/api/v1/synthetic/scenarios/run"),
    ).toBe(false);
    expect(
      isPublicAtlasRoute("POST", "/api/v1/synthetic/scenarios/closed-loop"),
    ).toBe(false);
    expect(isPublicAtlasRoute("GET", "/api/v1/internal/kill-switches")).toBe(
      false,
    );
    expect(isPublicAtlasRoute("POST", "/api/v1/internal/kill-switches")).toBe(
      false,
    );
    expect(isPublicAtlasRoute("GET", "/api/v1/internal/approvals")).toBe(false);
  });

  it("treats HEAD as the matching GET allow-list, not as universally public", () => {
    expect(isPublicAtlasRoute("HEAD", "/health")).toBe(true);
    expect(isPublicAtlasRoute("HEAD", "/api/v1/health")).toBe(true);
    expect(isPublicAtlasRoute("HEAD", "/api/v1/knowledge")).toBe(true);
    expect(isPublicAtlasRoute("HEAD", "/api/v1/onboarding/storage-policy")).toBe(
      true,
    );
    expect(isPublicAtlasRoute("HEAD", "/api/v1/memory")).toBe(false);
    expect(isPublicAtlasRoute("HEAD", "/api/v1/metrics")).toBe(false);
    expect(isPublicAtlasRoute("HEAD", "/api/v1/internal/kill-switches")).toBe(
      false,
    );
    expect(isPublicAtlasRoute("OPTIONS", "/api/v1/memory")).toBe(true);
    expect(isPublicAtlasRoute("OPTIONS", "/api/v1/metrics")).toBe(true);
    expect(isPublicAtlasRoute("POST", "/api/v1/memory")).toBe(false);
  });
});
