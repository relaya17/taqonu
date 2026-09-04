import { describe, expect, it } from "vitest";
import {
  applicationMayExecuteViaGateway,
  CONNECTED_APPLICATION_RUNTIME,
  getConnectedApplicationRuntime,
} from "./connected-applications.js";

describe("connected application runtime inventory", () => {
  it("only Atlas-self has a gateway fulfill execute contract", () => {
    const executable = CONNECTED_APPLICATION_RUNTIME.filter(
      (row) => row.execute === "GATEWAY_FULFILL",
    );
    expect(executable).toHaveLength(1);
    expect(executable[0]?.applicationId).toBe("def-000");
    expect(applicationMayExecuteViaGateway("def-000")).toBe(true);
    expect(applicationMayExecuteViaGateway("civio")).toBe(false);
    expect(applicationMayExecuteViaGateway("hotelos")).toBe(false);
  });

  it("Civio is HMAC evaluate-only and never an execute hop", () => {
    const civio = getConnectedApplicationRuntime("civio");
    expect(civio?.connection).toBe("HMAC_CONNECTOR");
    expect(civio?.ingest).toBe("EVALUATE_ONLY");
    expect(civio?.execute).toBe("NONE");
    expect(civio?.executeGap).toEqual({
      authentication: "PRESENT",
      actions: "ABSENT",
      target: "ABSENT",
      artifact: "ABSENT",
      adr022: "PERMITS_EVALUATE_ONLY",
    });
    expect(civio?.reconciliation.classification).toBe("EVALUATE-ONLY");
    expect(civio?.reconciliation.missingAction).toMatch(/CIVIO_SUPPORTED_ACTIONS/);
  });

  it("classifies Atlas-self as real execution ready and siblings as inventory only", () => {
    expect(getConnectedApplicationRuntime("def-000")?.reconciliation.classification).toBe(
      "REAL EXECUTION READY",
    );
    for (const id of ["caseflow", "hotelos", "brokeros", "lexstudy", "vantera"] as const) {
      expect(getConnectedApplicationRuntime(id)?.reconciliation.classification).toBe(
        "INVENTORY ONLY",
      );
    }
  });

  it("siblings remain inventory-only with no execute contract", () => {
    for (const id of ["caseflow", "hotelos", "brokeros", "lexstudy", "vantera"] as const) {
      const row = getConnectedApplicationRuntime(id);
      expect(row?.connection).toBe("INVENTORY_ONLY");
      expect(row?.execute).toBe("NONE");
      expect(row?.ingest).toBe("NONE");
      expect(row?.executeGap.authentication).toBe("ABSENT");
      expect(row?.executeGap.actions).toBe("ABSENT");
      expect(row?.executeGap.target).toBe("ABSENT");
      expect(row?.executeGap.artifact).toBe("ABSENT");
      expect(row?.executeGap.adr022).toBe("OBSERVE_ONLY");
      expect(row?.reconciliation.classification).toBe("INVENTORY ONLY");
      expect(row?.reconciliation.executionEndpoint).toBe("none");
    }
    expect(getConnectedApplicationRuntime("hotelos")?.reconciliation.siblingObservePath).toMatch(
      /gateway\/events/,
    );
    expect(getConnectedApplicationRuntime("caseflow")?.reconciliation.siblingObservePath).toMatch(
      /gateway\/events/,
    );
  });
});
