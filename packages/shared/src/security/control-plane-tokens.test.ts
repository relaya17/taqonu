import { afterEach, describe, expect, it } from "vitest";
import {
  matchControlPlaneBearer,
  matchControlPlaneServiceToken,
} from "./control-plane-tokens.js";

describe("control-plane token rotation", () => {
  afterEach(() => {
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS;
    delete process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN;
    delete process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS;
  });

  it("accepts the current operator token and rejects a stranger", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "current-op";
    expect(matchControlPlaneBearer("current-op")).toBe("OPERATOR");
    expect(matchControlPlaneServiceToken("current-op")).toBe(true);
    expect(matchControlPlaneBearer("stranger")).toBeNull();
    expect(matchControlPlaneServiceToken("stranger")).toBe(false);
  });

  it("accepts the previous operator token during rotation", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "new-op";
    process.env.ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS = "old-op";
    expect(matchControlPlaneBearer("old-op")).toBe("OPERATOR");
    expect(matchControlPlaneServiceToken("old-op")).toBe(true);
    expect(matchControlPlaneBearer("new-op")).toBe("OPERATOR");
  });

  it("accepts previous owner token as OWNER", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "op";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN = "new-owner";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN_PREVIOUS = "old-owner";
    expect(matchControlPlaneBearer("old-owner")).toBe("OWNER");
    expect(matchControlPlaneServiceToken("old-owner")).toBe(false);
  });

  it("never elevates when an owner secret collides with an operator secret", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "shared";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN = "shared";
    expect(matchControlPlaneBearer("shared")).toBe("OPERATOR");
  });

  it("never elevates when previous operator equals current owner", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "new-op";
    process.env.ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS = "owner-now";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN = "owner-now";
    expect(matchControlPlaneBearer("owner-now")).toBe("OPERATOR");
  });
});
