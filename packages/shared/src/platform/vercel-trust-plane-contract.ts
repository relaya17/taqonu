/**
 * Repository-level ADR-021 / demo-login contract for checked-in vercel.json.
 * This does not prove live Vercel dashboard env, and it does not pause
 * public Control Plane. It fail-closes source defaults that would publish
 * demo login or a public Control/Admin hop.
 */

export function isLoopbackHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return (
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export interface VercelTrustPlaneFinding {
  readonly file: string;
  readonly ok: boolean;
  readonly evidence: string;
}

export type VercelTrustPlane = "user" | "control" | "admin";

export function evaluateVercelJsonEnv(input: {
  readonly file: string;
  readonly plane: VercelTrustPlane;
  readonly env: Readonly<Record<string, string | undefined>>;
}): readonly VercelTrustPlaneFinding[] {
  const findings: VercelTrustPlaneFinding[] = [];
  for (const key of [
    "ATLAS_DEMO_LOGIN_ENABLED",
    "NEXT_PUBLIC_DEMO_LOGIN_ENABLED",
  ] as const) {
    if (input.env[key] === "1") {
      findings.push({
        file: input.file,
        ok: false,
        evidence: `${key}=1 is a production-default demo-login enablement. Source defaults must not enable demo login.`,
      });
    }
  }

  if (input.plane === "admin") {
    const controlUrl = input.env.ATLAS_CONTROL_PLANE_URL;
    if (controlUrl && !isLoopbackHttpOrigin(controlUrl)) {
      findings.push({
        file: input.file,
        ok: false,
        evidence:
          "ATLAS_CONTROL_PLANE_URL must be a loopback http(s) origin per ADR-021. A public Control URL is a trust-plane violation.",
      });
    }
  }

  if (input.plane === "user") {
    const authPath = input.env.ATLAS_AUTH_PATH;
    if (authPath && /(^|[/\\])tmp([/\\]|$)/i.test(authPath)) {
      findings.push({
        file: input.file,
        ok: false,
        evidence:
          "ATLAS_AUTH_PATH must not be an ephemeral tmp path. Production user identity is Supabase Auth, not the serverless filesystem.",
      });
    }
  }

  if (input.plane === "control") {
    const adminUrl = input.env.ATLAS_ADMIN_URL;
    if (adminUrl && !isLoopbackHttpOrigin(adminUrl)) {
      findings.push({
        file: input.file,
        ok: false,
        evidence:
          "ATLAS_ADMIN_URL must be a loopback http(s) origin per ADR-021. A public Admin URL is a trust-plane violation.",
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      file: input.file,
      ok: true,
      evidence:
        "vercel.json env satisfies the repository ADR-021 / demo-login contract",
    });
  }
  return findings;
}

export function vercelTrustPlaneContractOk(
  findings: readonly VercelTrustPlaneFinding[],
): boolean {
  return findings.every((row) => row.ok);
}
