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

export interface UnsignedProvenanceStatement {
  readonly _type: "https://in-toto.io/Statement/v1";
  readonly predicateType: "https://slsa.dev/provenance/v1";
  readonly subject: readonly { readonly name: string; readonly digest: { readonly sha256: string } }[];
  readonly predicate: {
    readonly buildDefinition: {
      readonly buildType: "https://atlas.local/build/pnpm-turbo@v1";
      readonly externalParameters: {
        readonly repository: string;
        readonly commit: string;
      };
    };
    readonly runDetails: {
      readonly builder: { readonly id: string };
      readonly signed: false;
    };
  };
}

export function buildUnsignedProvenance(input: {
  readonly sbomSha256: string;
  readonly commit: string;
  readonly repository: string;
  readonly builderId?: string;
}): UnsignedProvenanceStatement {
  return {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: "sbom.json", digest: { sha256: input.sbomSha256 } }],
    predicate: {
      buildDefinition: {
        buildType: "https://atlas.local/build/pnpm-turbo@v1",
        externalParameters: {
          repository: input.repository,
          commit: input.commit,
        },
      },
      runDetails: {
        builder: { id: input.builderId ?? "local/pnpm" },
        signed: false,
      },
    },
  };
}

export function verifyUnsignedProvenance(
  statement: unknown,
  expectedSbomSha256?: string,
): { readonly ok: boolean; readonly signed: false; readonly evidence: string } {
  if (!statement || typeof statement !== "object") {
    return { ok: false, signed: false, evidence: "provenance statement missing" };
  }
  const row = statement as {
    readonly _type?: unknown;
    readonly predicateType?: unknown;
    readonly subject?: readonly { readonly digest?: { readonly sha256?: unknown } }[];
    readonly predicate?: { readonly runDetails?: { readonly signed?: unknown } };
  };
  if (row._type !== "https://in-toto.io/Statement/v1") {
    return { ok: false, signed: false, evidence: "not an in-toto Statement" };
  }
  if (row.predicateType !== "https://slsa.dev/provenance/v1") {
    return { ok: false, signed: false, evidence: "not SLSA provenance v1" };
  }
  if (row.predicate?.runDetails?.signed !== false) {
    return {
      ok: false,
      signed: false,
      evidence: "unsigned provenance must not claim signed:true",
    };
  }
  const digest = row.subject?.[0]?.digest?.sha256;
  if (typeof digest !== "string" || !digest || (expectedSbomSha256 && digest !== expectedSbomSha256)) {
    return { ok: false, signed: false, evidence: "SBOM digest mismatch or missing" };
  }
  return {
    ok: true,
    signed: false,
    evidence: "Unsigned SLSA-shaped provenance is recorded. Not a signed release.",
  };
}

export type ReleaseSignPlan =
  | {
      readonly action: "REFUSE";
      readonly signing: "UNSIGNED";
      readonly reason: string;
    }
  | {
      readonly action: "REFUSE";
      readonly signing: "INVALID";
      readonly reason: string;
    }
  | {
      readonly action: "SIGN";
      readonly signingIdentity: string;
    };

/**
 * Decide whether a real cosign/Sigstore ceremony may run.
 * Never plans a placeholder signature.
 */
export function planReleaseSignature(input: {
  readonly signingIdentity?: string | null;
  readonly cosignAvailable: boolean;
  readonly signatureAlreadyPresent?: boolean;
}): ReleaseSignPlan {
  const identity = input.signingIdentity?.trim() ?? "";
  if (identity.length === 0) {
    if (input.signatureAlreadyPresent) {
      return {
        action: "REFUSE",
        signing: "INVALID",
        reason:
          "Signature file is present but ATLAS_SIGNING_IDENTITY is unset. Fail closed — do not treat an unverifiable blob as signed.",
      };
    }
    return {
      action: "REFUSE",
      signing: "UNSIGNED",
      reason:
        "ATLAS_SIGNING_IDENTITY is unset. Do not mint a placeholder signature. Owner must provision Sigstore/cosign identity.",
    };
  }
  if (!input.cosignAvailable) {
    return {
      action: "REFUSE",
      signing: "INVALID",
      reason:
        "Signing identity is configured but cosign is not on PATH. Do not fake VERIFIED. Deploy the verifier with the identity.",
    };
  }
  return { action: "SIGN", signingIdentity: identity };
}
