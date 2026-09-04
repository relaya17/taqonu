#!/usr/bin/env tsx
/**
 * Supply-chain verify CLI.
 * SBOM validity is enforceable. Signing remains fail-closed until an Owner
 * provisions a Sigstore/cosign identity and verifier.
 *
 * Usage: pnpm supply-chain:verify
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifySupplyChainArtifacts } from "@atlas/shared";

function repoRoot(): string {
  return resolve(process.cwd());
}

const sbomPath = join(repoRoot(), ".atlas", "sbom", "sbom.json");
const signaturePath = join(repoRoot(), ".atlas", "sbom", "sbom.json.sig");
const result = verifySupplyChainArtifacts({
  sbomJson: existsSync(sbomPath) ? readFileSync(sbomPath, "utf8") : null,
  signaturePresent: existsSync(signaturePath),
  signingIdentity: process.env.ATLAS_SIGNING_IDENTITY ?? null,
});

console.log(JSON.stringify(result, null, 2));

if (result.sbom === "INVALID") {
  process.exit(1);
}

if (process.env.ATLAS_REQUIRE_SIGNED_RELEASE === "1" && !result.releaseReady) {
  process.exit(1);
}
