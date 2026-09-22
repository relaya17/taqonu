import { describe, expect, it } from "vitest";
import { inboxKindMessageKey } from "./inbox-kind";

describe("inboxKindMessageKey", () => {
  it("maps API kinds onto next-intl keys that do not contain dots", () => {
    expect(inboxKindMessageKey("memory.pending")).toBe("memoryPending");
    expect(inboxKindMessageKey("approval.waiting")).toBe("approvalWaiting");
    expect(inboxKindMessageKey("patch.ready")).toBe("patchReady");
    expect(inboxKindMessageKey("memory.pending")).not.toMatch(/\./);
  });
});
