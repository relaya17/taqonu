#!/usr/bin/env tsx
/**
 * Repository publish guard CLI.
 * Fail-closes unsafe checked-in Vercel defaults and optional SHA mismatch.
 * Does not control Vercel Git auto-deploy.
 *
 * Usage: pnpm production:publish-guard
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProductionPublishGuard } from "../packages/shared/src/platform/production-publish-guard.ts";
import type { VercelTrustPlane } from "../packages/shared/src/platform/vercel-trust-plane-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(relativePath: string): Record<string, string | undefined> {
  const parsed = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as {
    env?: Record<string, string>;
  };
  return parsed.env ?? {};
}

function provenanceCommit(): string | null {
  const path = join(root, ".atlas", "sbom", "provenance.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      predicate?: {
        buildDefinition?: { externalParameters?: { commit?: unknown } };
      };
    };
    const commit = parsed.predicate?.buildDefinition?.externalParameters?.commit;
    return typeof commit === "string" && commit.trim() ? commit.trim() : null;
  } catch {
    return null;
  }
}

const planes: { file: string; plane: VercelTrustPlane; env: Record<string, string | undefined> }[] =
  [
    { file: "apps/web/vercel.json", plane: "user", env: readEnv("apps/web/vercel.json") },
    { file: "apps/api/vercel.json", plane: "user", env: readEnv("apps/api/vercel.json") },
    { file: "apps/admin/vercel.json", plane: "admin", env: readEnv("apps/admin/vercel.json") },
    {
      file: "apps/control-plane/vercel.json",
      plane: "control",
      env: readEnv("apps/control-plane/vercel.json"),
    },
  ];

const expectedCommit = process.env.GITHUB_SHA?.trim() || "";
const proven = provenanceCommit();
const result = evaluateProductionPublishGuard({
  planes,
  nodeEnv: process.env.NODE_ENV,
  ...(expectedCommit && proven
    ? { expectedCommit, provenanceCommit: proven }
    : {}),
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
