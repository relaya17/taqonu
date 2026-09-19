import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateVercelJsonEnv,
  isLoopbackHttpOrigin,
  vercelTrustPlaneContractOk,
} from "./vercel-trust-plane-contract.js";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function readVercelEnv(relativePath: string): Record<string, string | undefined> {
  const parsed = JSON.parse(
    readFileSync(join(repoRoot, relativePath), "utf8"),
  ) as { env?: Record<string, string> };
  return parsed.env ?? {};
}

describe("isLoopbackHttpOrigin", () => {
  it("accepts loopback http origins and rejects public hosts", () => {
    expect(isLoopbackHttpOrigin("http://127.0.0.1:3100")).toBe(true);
    expect(isLoopbackHttpOrigin("http://localhost:3200")).toBe(true);
    expect(isLoopbackHttpOrigin("https://taqonu-control-plane.vercel.app")).toBe(
      false,
    );
    expect(isLoopbackHttpOrigin("not-a-url")).toBe(false);
  });
});

describe("evaluateVercelJsonEnv", () => {
  it("fail-closes demo login enablement and public Control URLs", () => {
    const findings = evaluateVercelJsonEnv({
      file: "apps/admin/vercel.json",
      plane: "admin",
      env: {
        ATLAS_DEMO_LOGIN_ENABLED: "1",
        ATLAS_CONTROL_PLANE_URL: "https://taqonu-control-plane.vercel.app",
      },
    });
    expect(vercelTrustPlaneContractOk(findings)).toBe(false);
    expect(findings.some((row) => row.evidence.includes("demo-login"))).toBe(
      true,
    );
    expect(findings.some((row) => row.evidence.includes("ADR-021"))).toBe(true);
  });

  it("rejects a public Admin URL on Control Plane", () => {
    const findings = evaluateVercelJsonEnv({
      file: "apps/control-plane/vercel.json",
      plane: "control",
      env: { ATLAS_ADMIN_URL: "https://taqonu-admin.vercel.app" },
    });
    expect(vercelTrustPlaneContractOk(findings)).toBe(false);
  });

  it("accepts Admin loopback Control and Control loopback Admin", () => {
    expect(
      vercelTrustPlaneContractOk(
        evaluateVercelJsonEnv({
          file: "apps/admin/vercel.json",
          plane: "admin",
          env: { ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100" },
        }),
      ),
    ).toBe(true);
    expect(
      vercelTrustPlaneContractOk(
        evaluateVercelJsonEnv({
          file: "apps/control-plane/vercel.json",
          plane: "control",
          env: { ATLAS_ADMIN_URL: "http://127.0.0.1:3200" },
        }),
      ),
    ).toBe(true);
  });
});

describe("checked-in vercel.json files", () => {
  it("keep demo login off and private-plane hops on loopback", () => {
    const web = evaluateVercelJsonEnv({
      file: "apps/web/vercel.json",
      plane: "user",
      env: readVercelEnv("apps/web/vercel.json"),
    });
    const api = evaluateVercelJsonEnv({
      file: "apps/api/vercel.json",
      plane: "user",
      env: readVercelEnv("apps/api/vercel.json"),
    });
    const admin = evaluateVercelJsonEnv({
      file: "apps/admin/vercel.json",
      plane: "admin",
      env: readVercelEnv("apps/admin/vercel.json"),
    });
    const control = evaluateVercelJsonEnv({
      file: "apps/control-plane/vercel.json",
      plane: "control",
      env: readVercelEnv("apps/control-plane/vercel.json"),
    });
    expect(vercelTrustPlaneContractOk(web)).toBe(true);
    expect(vercelTrustPlaneContractOk(api)).toBe(true);
    expect(vercelTrustPlaneContractOk(admin)).toBe(true);
    expect(vercelTrustPlaneContractOk(control)).toBe(true);
  });
});
