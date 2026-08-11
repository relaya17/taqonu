import { describe, expect, it } from "vitest";
import { authorizeToolCall } from "./authorization.js";

describe("authorizeToolCall", () => {
  it("allows read tools in READ mode", () => {
    const result = authorizeToolCall({
      toolName: "memory.search",
      mode: "READ",
    });
    expect(result.decision).toBe("ALLOWED");
  });

  it("blocks WRITE until eval gate opens", () => {
    const result = authorizeToolCall({
      toolName: "github.create_pr",
      mode: "WRITE",
      approved: true,
      writeGateOpen: false,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("requires approval even when write gate is open", () => {
    const result = authorizeToolCall({
      toolName: "github.create_pr",
      mode: "WRITE",
      writeGateOpen: true,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("denies write tools in READ mode", () => {
    const result = authorizeToolCall({
      toolName: "github.create_pr",
      mode: "READ",
      approved: true,
      writeGateOpen: true,
    });
    expect(result.decision).toBe("DENIED");
  });
});
