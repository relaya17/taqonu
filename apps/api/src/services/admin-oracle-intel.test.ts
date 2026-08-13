import { describe, expect, it } from "vitest";
import { isVersionBelow } from "./admin-oracle-intel.js";

describe("isVersionBelow", () => {
  it("detects vulnerable package versions", () => {
    expect(isVersionBelow("7.5.1", "7.5.2")).toBe(true);
    expect(isVersionBelow("7.5.2", "7.5.2")).toBe(false);
    expect(isVersionBelow("^8.17.0", "8.17.1")).toBe(true);
    expect(isVersionBelow("8.18.0", "8.17.1")).toBe(false);
  });
});
