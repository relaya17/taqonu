import { describe, expect, it } from "vitest";
import { transitionDecisionSchema } from "./decision.schema.js";

describe("transitionDecisionSchema", () => {
  it("accepts ACTIVE and REJECTED without supersededBy", () => {
    expect(transitionDecisionSchema.parse({ status: "ACTIVE" }).status).toBe(
      "ACTIVE",
    );
    expect(transitionDecisionSchema.parse({ status: "REJECTED" }).status).toBe(
      "REJECTED",
    );
  });

  it("requires supersededBy for SUPERSEDED", () => {
    expect(() =>
      transitionDecisionSchema.parse({ status: "SUPERSEDED" }),
    ).toThrow();
    const ok = transitionDecisionSchema.parse({
      status: "SUPERSEDED",
      supersededBy: "11111111-1111-4111-8111-111111111111",
    });
    expect(ok.supersededBy).toBe("11111111-1111-4111-8111-111111111111");
  });
});
