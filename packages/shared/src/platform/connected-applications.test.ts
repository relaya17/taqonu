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
  });

  it("siblings remain inventory-only", () => {
    for (const id of ["caseflow", "hotelos", "brokeros", "lexstudy", "vantera"] as const) {
      const row = getConnectedApplicationRuntime(id);
      expect(row?.connection).toBe("INVENTORY_ONLY");
      expect(row?.execute).toBe("NONE");
      expect(row?.ingest).toBe("NONE");
    }
  });
});
