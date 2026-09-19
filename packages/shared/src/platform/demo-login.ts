/**
 * Demo login is a local-development convenience.
 * NODE_ENV=production never enables it. An env flag cannot override that.
 * Callers may still pass the flag so production configs are auditable;
 * it is ignored when nodeEnv is production.
 */
export function isAtlasDemoLoginEnabled(input?: {
  readonly nodeEnv?: string | null | undefined;
  readonly flag?: string | null | undefined;
}): boolean {
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV;
  void input?.flag;
  return nodeEnv !== "production";
}

/**
 * Configuration guardrail: production must not *attempt* to enable demo login.
 * Distinct from runtime: runtime ignores the flag; this rejects the config.
 */
export function evaluateProductionDemoLoginConfig(input: {
  readonly nodeEnv?: string | null | undefined;
  readonly flag?: string | null | undefined;
}): { readonly ok: boolean; readonly evidence: string } {
  if (input.nodeEnv === "production" && input.flag === "1") {
    return {
      ok: false,
      evidence:
        "production + demo-login enabled is forbidden. Disable the flag; runtime ignore is not a publishable configuration.",
    };
  }
  return {
    ok: true,
    evidence: "production demo-login is not enabled in this configuration",
  };
}
