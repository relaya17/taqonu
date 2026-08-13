import { describe, expect, it } from "vitest";
import { buildDefaultStoragePolicy, storagePolicySchema } from "./byo-cloud.schema.js";

describe("storage policy v2", () => {
  it("builds a valid BYO_CUSTOMER_CLOUD policy", () => {
    const policy = buildDefaultStoragePolicy();
    expect(policy.model).toBe("BYO_CUSTOMER_CLOUD");
    expect(policy.preferredCustomerCloud).toBe("cloudflare");
    expect(policy.atlasEvidenceMirrorSlots.free).toBe(0);
    expect(policy.freeCloudProjectSlots).toBe(0);
    expect(policy.usageLimits.free.processAuditsPerDay).toBeGreaterThan(0);
    expect(() => storagePolicySchema.parse(policy)).not.toThrow();
  });
});
