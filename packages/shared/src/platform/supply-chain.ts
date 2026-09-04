/**
 * Supply-chain verification — SBOM is enforceable; signing is fail-closed.
 *
 * Do not mint a signature. Absence is UNSIGNED, never VERIFIED.
 * A signature file without a configured identity is INVALID.
 */

export type SbomVerifyStatus = "VALID" | "MISSING" | "INVALID";
export type SigningVerifyStatus = "UNSIGNED" | "INVALID" | "VERIFIED";

export interface SupplyChainVerifyResult {
  readonly sbom: SbomVerifyStatus;
  readonly signing: SigningVerifyStatus;
  readonly releaseReady: boolean;
  readonly evidence: string;
  readonly signingIdentityConfigured: boolean;
}

export interface SupplyChainVerifyInput {
  readonly sbomJson?: string | null;
  readonly signaturePresent?: boolean;
  readonly signingIdentity?: string | null;
}

function parseCycloneDx(raw: string): { ok: true; components: number } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(raw) as {
      bomFormat?: unknown;
      specVersion?: unknown;
      components?: unknown;
    };
    if (parsed.bomFormat !== "CycloneDX") {
      return { ok: false, reason: "bomFormat is not CycloneDX" };
    }
    if (typeof parsed.specVersion !== "string" || parsed.specVersion.length === 0) {
      return { ok: false, reason: "specVersion missing" };
    }
    if (!Array.isArray(parsed.components) || parsed.components.length === 0) {
      return { ok: false, reason: "components empty" };
    }
    return { ok: true, components: parsed.components.length };
  } catch {
    return { ok: false, reason: "SBOM JSON is not parseable" };
  }
}

export function verifySupplyChainArtifacts(
  input: SupplyChainVerifyInput = {},
): SupplyChainVerifyResult {
  const identity = input.signingIdentity?.trim() ?? "";
  const identityConfigured = identity.length > 0;

  if (!input.sbomJson || input.sbomJson.trim().length === 0) {
    return {
      sbom: "MISSING",
      signing: input.signaturePresent ? "INVALID" : "UNSIGNED",
      releaseReady: false,
      evidence: "SBOM is missing. Do not claim a signed release.",
      signingIdentityConfigured: identityConfigured,
    };
  }

  const parsed = parseCycloneDx(input.sbomJson);
  if (!parsed.ok) {
    return {
      sbom: "INVALID",
      signing: input.signaturePresent ? "INVALID" : "UNSIGNED",
      releaseReady: false,
      evidence: parsed.reason,
      signingIdentityConfigured: identityConfigured,
    };
  }

  if (!input.signaturePresent) {
    return {
      sbom: "VALID",
      signing: "UNSIGNED",
      releaseReady: false,
      evidence: `SBOM valid (components=${parsed.components}). No signature file. Owner must provision a signing identity before a release claim.`,
      signingIdentityConfigured: identityConfigured,
    };
  }

  if (!identityConfigured) {
    return {
      sbom: "VALID",
      signing: "INVALID",
      releaseReady: false,
      evidence:
        "Signature file is present but ATLAS_SIGNING_IDENTITY is unset. Fail closed — do not treat an unverifiable blob as signed.",
      signingIdentityConfigured: false,
    };
  }

  return {
    sbom: "VALID",
    signing: "INVALID",
    releaseReady: false,
    evidence:
      "Signing identity is configured but this repository has no Sigstore/cosign verifier. Do not fake VERIFIED. Deploy the verifier with the identity.",
    signingIdentityConfigured: true,
  };
}
