import { describe, expect, it } from "vitest";
import { assertControlPlaneApiEgress } from "./control-plane-egress.js";

describe("Control Plane API egress", () => {
  it("allows the existing tenant-API hop as atlas_internal TELEMETRY", () => {
    expect(assertControlPlaneApiEgress("lifecycle-handoff")).toBeNull();
  });
});
