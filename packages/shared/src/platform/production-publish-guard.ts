/**
 * Repository publish guard.
 * Validates checked-in production defaults and optional commit identity.
 * Does not control Vercel Git auto-deploy. Platform enforcement is NOT_PROVEN.
 */
import { evaluateProductionDemoLoginConfig } from "./demo-login.js";
import {
  evaluateVercelJsonEnv,
  vercelTrustPlaneContractOk,
  type VercelTrustPlane,
} from "./vercel-trust-plane-contract.js";

export interface PublishGuardPlaneInput {
  readonly file: string;
  readonly plane: VercelTrustPlane;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ProductionPublishGuardInput {
  readonly planes: readonly PublishGuardPlaneInput[];
  readonly nodeEnv?: string | null;
  readonly expectedCommit?: string | null;
  readonly provenanceCommit?: string | null;
}

export interface ProductionPublishGuardResult {
  readonly ok: boolean;
  readonly vercelPlatformEnforcement: "NOT_PROVEN";
  readonly evidence: readonly string[];
}

export function evaluateProductionPublishGuard(
  input: ProductionPublishGuardInput,
): ProductionPublishGuardResult {
  const evidence: string[] = [
    "Vercel Git auto-deploy is not controlled by this repository guard. Platform enforcement is NOT_PROVEN.",
  ];
  let ok = true;

  for (const plane of input.planes) {
    const findings = evaluateVercelJsonEnv(plane);
    if (!vercelTrustPlaneContractOk(findings)) {
      ok = false;
      for (const finding of findings) {
        if (!finding.ok) evidence.push(`${finding.file}: ${finding.evidence}`);
      }
    }
    const demoFlag =
      plane.env.ATLAS_DEMO_LOGIN_ENABLED ??
      plane.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED;
    const demo = evaluateProductionDemoLoginConfig({
      nodeEnv: input.nodeEnv,
      flag: demoFlag,
    });
    if (!demo.ok) {
      ok = false;
      evidence.push(`${plane.file}: ${demo.evidence}`);
    }
  }

  const expected = input.expectedCommit?.trim() || "";
  const provenance = input.provenanceCommit?.trim() || "";
  if (expected && provenance && expected !== provenance) {
    ok = false;
    evidence.push("provenance commit does not match expected SHA");
  }
  if (expected && !provenance) {
    ok = false;
    evidence.push("expected commit is set but provenance commit is missing");
  }

  if (ok) {
    evidence.push("repository publish guard PASS — not a Vercel platform gate");
  }

  return {
    ok,
    vercelPlatformEnforcement: "NOT_PROVEN",
    evidence,
  };
}
