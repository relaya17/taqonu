import { describe, expect, it } from "vitest";
import { createStudioRunAbort } from "./studio-run-abort";

describe("createStudioRunAbort", () => {
  it("starts a live signal and cancel() aborts it", () => {
    const run = createStudioRunAbort();
    const signal = run.start();
    expect(run.isPending()).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(run.cancel()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(run.isPending()).toBe(false);
  });

  it("start() aborts a previous in-flight controller", () => {
    const run = createStudioRunAbort();
    const first = run.start();
    const second = run.start();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(run.cancel()).toBe(true);
  });
});
