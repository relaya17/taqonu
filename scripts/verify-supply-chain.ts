#!/usr/bin/env tsx
/**
 * Supply-chain verify CLI.
 * SBOM validity is enforceable. Signing remains fail-closed until an Owner
 * provisions a Sigstore/cosign identity and verifier.
 * Unsigned SLSA-shaped provenance is recorded and checked; it is not a signature.
 *
 * Usage: pnpm supply-chain:verify
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifySupplyChainArtifacts, verifyUnsignedProvenance } from "../packages/shared/src/platform/supply-chain.ts";

function repoRoot(): string {
  return resolve(process.cwd());
}

const sbomPath = join(repoRoot(), ".atlas", "sbom", "sbom.json");
const signaturePath = join(repoRoot(), ".atlas", "sbom", "sbom.json.sig");
const provenancePath = join(repoRoot(), ".atlas", "sbom", "provenance.json");
const result = verifySupplyChainArtifacts({
  sbomJson: existsSync(sbomPath) ? readFileSync(sbomPath, "utf8") : null,
  signaturePresent: existsSync(signaturePath),
  signingIdentity: process.env.ATLAS_SIGNING_IDENTITY ?? null,
});

let provenance: { ok: boolean; signed: false; evidence: string } | null = null;
if (existsSync(provenancePath) && existsSync(sbomPath)) {
  const sbomSha256 = createHash("sha256").update(readFileSync(sbomPath)).digest("hex");
  provenance = verifyUnsignedProvenance(
    JSON.parse(readFileSync(provenancePath, "utf8")),
    sbomSha256,
  );
}

console.log(
  JSON.stringify(
    {
      ...result,
      provenance: provenance ?? {
        ok: false,
        signed: false,
        evidence: "Unsigned provenance file is missing. Not a signed release.",
      },
    },
    null,
    2,
  ),
);

if (result.sbom === "INVALID") {
  process.exit(1);
}

if (provenance && !provenance.ok) {
  process.exit(1);
}

if (process.env.ATLAS_REQUIRE_SIGNED_RELEASE === "1" && !result.releaseReady) {
  process.exit(1);
}
