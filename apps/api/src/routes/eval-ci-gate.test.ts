import { describe, expect, it } from "vitest";
import { evaluateCiGateForTests } from "./eval-ci-gate.js";

describe("eval ci-gate", () => {
  it("passes blocking checks (redaction + write gate closed)", () => {
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    const result = evaluateCiGateForTests();
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.checks.find((c) => c.id === "secret_redaction")?.passed).toBe(
      true,
    );
    expect(result.checks.find((c) => c.id === "write_gate_closed")?.passed).toBe(
      true,
    );
  });
});
