#!/usr/bin/env tsx
/**
 * Release signing attempt.
 * Never writes a placeholder signature. Unsigned remains UNSIGNED.
 *
 * Usage: pnpm supply-chain:sign
 *
 * Real signing requires ATLAS_SIGNING_IDENTITY and `cosign` on PATH.
 * ATLAS_REQUIRE_SIGNED_RELEASE=1 exits non-zero while unsigned.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { planReleaseSignature } from "../packages/shared/src/platform/supply-chain.ts";

function cosignAvailable(): boolean {
  const result = spawnSync("cosign", ["version"], {
    encoding: "utf8",
    shell: true,
    timeout: 8_000,
  });
  return result.status === 0;
}

const root = resolve(process.cwd());
const sbomPath = join(root, ".atlas", "sbom", "sbom.json");
const signaturePath = join(root, ".atlas", "sbom", "sbom.json.sig");
const plan = planReleaseSignature({
  signingIdentity: process.env.ATLAS_SIGNING_IDENTITY ?? null,
  cosignAvailable: cosignAvailable(),
  signatureAlreadyPresent: existsSync(signaturePath),
});

if (plan.action === "REFUSE") {
  const report = {
    action: plan.action,
    signing: plan.signing,
    releaseReady: false,
    evidence: plan.reason,
    signatureWritten: false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (plan.signing === "INVALID") {
    process.exit(1);
  }
  if (process.env.ATLAS_REQUIRE_SIGNED_RELEASE === "1") {
    process.exit(1);
  }
  process.exit(0);
}

if (!existsSync(sbomPath)) {
  console.log(
    JSON.stringify(
      {
        action: "REFUSE",
        signing: "UNSIGNED",
        releaseReady: false,
        evidence: "SBOM is missing. Generate with pnpm sbom:generate before signing.",
        signatureWritten: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const signed = spawnSync(
  "cosign",
  ["sign-blob", "--yes", "--bundle", `${signaturePath}.bundle`, sbomPath],
  { encoding: "utf8", shell: true, timeout: 60_000 },
);

if (signed.status !== 0) {
  console.log(
    JSON.stringify(
      {
        action: "SIGN",
        signing: "INVALID",
        releaseReady: false,
        evidence:
          "cosign sign-blob failed. No placeholder signature was written. Identity/OIDC/Fulcio must be provisioned by Owner.",
        signatureWritten: existsSync(signaturePath),
        stderr: (signed.stderr ?? "").slice(0, 400),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      action: "SIGN",
      signing: "ATTEMPTED",
      releaseReady: false,
      evidence:
        "cosign exited 0. Independent verification still requires the deployed verifier; this script does not set releaseReady.",
      signatureWritten: existsSync(signaturePath) || existsSync(`${signaturePath}.bundle`),
    },
    null,
    2,
  ),
);
process.exit(0);
