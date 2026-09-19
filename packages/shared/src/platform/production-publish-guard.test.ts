import { describe, expect, it } from "vitest";
import { evaluateProductionPublishGuard } from "./production-publish-guard.js";

const validPlanes = [
  {
    file: "apps/web/vercel.json",
    plane: "user" as const,
    env: { NEXT_PUBLIC_DEMO_LOGIN_ENABLED: "0" },
  },
  {
    file: "apps/admin/vercel.json",
    plane: "admin" as const,
    env: {
      ATLAS_DEMO_LOGIN_ENABLED: "0",
      ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    },
  },
  {
    file: "apps/control-plane/vercel.json",
    plane: "control" as const,
    env: {
      ATLAS_DEMO_LOGIN_ENABLED: "0",
      ATLAS_ADMIN_URL: "http://127.0.0.1:3200",
    },
  },
];

describe("evaluateProductionPublishGuard", () => {
  it("PASS: valid source defaults and matching commit", () => {
    const result = evaluateProductionPublishGuard({
      planes: validPlanes,
      nodeEnv: "production",
      expectedCommit: "abc123",
      provenanceCommit: "abc123",
    });
    expect(result.ok).toBe(true);
    expect(result.vercelPlatformEnforcement).toBe("NOT_PROVEN");
  });

  it("FAIL: mismatched commit is blocked", () => {
    const result = evaluateProductionPublishGuard({
      planes: validPlanes,
      expectedCommit: "abc123",
      provenanceCommit: "other",
    });
    expect(result.ok).toBe(false);
    expect(result.evidence.some((row) => /does not match expected SHA/.test(row))).toBe(
      true,
    );
  });

  it("FAIL: expected commit without provenance is blocked", () => {
    const result = evaluateProductionPublishGuard({
      planes: validPlanes,
      expectedCommit: "abc123",
      provenanceCommit: null,
    });
    expect(result.ok).toBe(false);
  });

  it("FAIL: public Control URL is blocked", () => {
    const result = evaluateProductionPublishGuard({
      planes: [
        {
          file: "apps/admin/vercel.json",
          plane: "admin",
          env: {
            ATLAS_CONTROL_PLANE_URL: "https://taqonu-control-plane.vercel.app",
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("FAIL: production demo-login enablement is blocked", () => {
    const result = evaluateProductionPublishGuard({
      planes: [
        {
          file: "apps/web/vercel.json",
          plane: "user",
          env: { NEXT_PUBLIC_DEMO_LOGIN_ENABLED: "1" },
        },
      ],
      nodeEnv: "production",
    });
    expect(result.ok).toBe(false);
  });
});
