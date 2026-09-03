import { describe, expect, it } from "vitest";
import {
  CONTROL_OPERATIONAL_DOMAINS,
  CONTROL_OPERATIONAL_LIFECYCLE,
  CONTROL_SUPERVISION_MODES,
  OPERATING_CYCLE_TO_CONTROL_LIFECYCLE,
  controlOperationalDomainContracts,
} from "./control-operations.js";

describe("Control operational contracts", () => {
  it("declares the supervision lifecycle without collapsing Admin or Studio", () => {
    expect(CONTROL_OPERATIONAL_LIFECYCLE).toEqual([
      "APPLICATION",
      "PROCESS",
      "EVENT",
      "CONTROL",
      "POLICY",
      "RISK",
      "DECISION",
      "APPROVAL",
      "EXECUTION",
      "VERIFICATION",
      "EVIDENCE",
      "AUDIT",
    ]);
    expect(CONTROL_SUPERVISION_MODES).toContain("OBSERVE");
    expect(CONTROL_SUPERVISION_MODES).toContain("MONITOR");
    expect(CONTROL_SUPERVISION_MODES).toContain("GOVERN");
  });

  it("maps the existing operating cycle onto the Control lifecycle", () => {
    expect(OPERATING_CYCLE_TO_CONTROL_LIFECYCLE.POLICY).toBe("POLICY");
    expect(OPERATING_CYCLE_TO_CONTROL_LIFECYCLE.EXECUTE).toBe("EXECUTION");
    expect(OPERATING_CYCLE_TO_CONTROL_LIFECYCLE.VERIFY).toBe("VERIFICATION");
  });

  it("does not claim live sibling connectors; process supervision is in-memory Control state", () => {
    const domains = controlOperationalDomainContracts();
    expect(domains.map((d) => d.domain)).toEqual([...CONTROL_OPERATIONAL_DOMAINS]);
    expect(domains.every((d) => d.live === false)).toBe(true);
    const processes = domains.find((d) => d.domain === "processes");
    expect(processes?.status).toBe("PARTIAL");
    expect(processes?.notes.some((note) => note.includes("process-audit"))).toBe(
      true,
    );
  });
});
