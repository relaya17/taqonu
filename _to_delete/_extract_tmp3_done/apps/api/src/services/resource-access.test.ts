import { describe, expect, it } from "vitest";
import { checkResourceAccess, explainDenial } from "./resource-access.js";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("checkResourceAccess", () => {
  it("ALLOWED: role has capability + owns resource", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "write.contract",
      resourceOwnerId: ACTOR,
    });
    expect(result.decision).toBe("ALLOWED");
  });

  it("DENIED: role has capability but does not own resource (non-admin)", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "write.contract",
      resourceOwnerId: OTHER,
    });
    expect(result.decision).toBe("DENIED");
    expect(result.reason).toMatch(/does not own/);
  });

  it("DENIED: role lacks capability entirely, regardless of ownership", () => {
    // "admin" is the only capability not granted to the "user" role.
    const owned = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "admin",
      resourceOwnerId: ACTOR,
    });
    expect(owned.decision).toBe("DENIED");
    expect(owned.reason).toMatch(/lacks required capability/);

    const unowned = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "admin",
      resourceOwnerId: null,
    });
    expect(unowned.decision).toBe("DENIED");
    expect(unowned.reason).toMatch(/lacks required capability/);
  });

  it("ALLOWED: admin role bypasses the ownership check", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "admin",
      requiredCapability: "write.contract",
      resourceOwnerId: OTHER,
    });
    expect(result.decision).toBe("ALLOWED");
    expect(result.reason).toMatch(/admin role bypasses ownership check/);
  });

  it("ALLOWED: resourceOwnerId null with capability present", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "write.patches.approve",
      resourceOwnerId: null,
    });
    expect(result.decision).toBe("ALLOWED");
    expect(result.reason).toMatch(/no single owner/);
  });

  it("DENIED: resourceOwnerId null without capability", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "admin",
      resourceOwnerId: null,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("explainDenial formats a result for logging", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "admin",
      resourceOwnerId: null,
    });
    expect(explainDenial(result)).toBe(`[DENIED] ${result.reason}`);
  });
});
