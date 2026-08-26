import { describe, expect, it } from "vitest";
import {
  CONTROL_PLANE_SERVICE_ID,
  controlPlaneServicePrincipal,
  isCustomerPrincipal,
  mayAccessControlPlane,
  mayAdministerCustomerDirectory,
  mayGrantControlPlaneRole,
  principalKindFromRole,
} from "./principals.js";

describe("Atlas principals", () => {
  it("separates customer admin from Atlas operator/owner", () => {
    expect(principalKindFromRole("user")).toBe("CUSTOMER_USER");
    expect(principalKindFromRole("admin")).toBe("CUSTOMER_ADMIN");
    expect(principalKindFromRole("operator")).toBe("ATLAS_OPERATOR");
    expect(principalKindFromRole("owner")).toBe("ATLAS_OWNER");
    expect(isCustomerPrincipal("CUSTOMER_ADMIN")).toBe(true);
    expect(isCustomerPrincipal("ATLAS_OPERATOR")).toBe(false);
  });

  it("does not let a customer admin onto the Control Plane", () => {
    expect(mayAccessControlPlane("CUSTOMER_ADMIN")).toBe(false);
    expect(mayAccessControlPlane("CUSTOMER_USER")).toBe(false);
    expect(mayAccessControlPlane("ATLAS_OPERATOR")).toBe(true);
    expect(mayAccessControlPlane("ATLAS_OWNER")).toBe(true);
    expect(mayAccessControlPlane("SERVICE")).toBe(true);
  });

  it("never grants Control Plane roles from a UI principal", () => {
    expect(mayGrantControlPlaneRole("CUSTOMER_ADMIN")).toBe(false);
    expect(mayGrantControlPlaneRole("ATLAS_OWNER")).toBe(false);
  });

  it("lets customer admin manage the tenant directory, not Atlas itself", () => {
    expect(mayAdministerCustomerDirectory("CUSTOMER_ADMIN")).toBe(true);
    expect(mayAdministerCustomerDirectory("CUSTOMER_USER")).toBe(false);
  });

  it("names the Control Plane token as a SERVICE, not atlas-owner", () => {
    expect(controlPlaneServicePrincipal()).toEqual({
      kind: "SERVICE",
      id: CONTROL_PLANE_SERVICE_ID,
    });
    expect(CONTROL_PLANE_SERVICE_ID).not.toBe("atlas-owner");
  });
});
