import { describe, expect, it } from "vitest";
import { pickLatestStudioPatch, studioContinuityView } from "./studio-continuity";

describe("studioContinuityView", () => {
  it("does not invent cost or a patch when sources are empty", () => {
    const view = studioContinuityView({
      lastPatch: null,
      lastRun: null,
      cost: null,
      boundFindingId: null,
    });
    expect(view.patchStatus).toBeNull();
    expect(view.costUsd).toBeNull();
    expect(view.boundFindingId).toBeNull();
  });

  it("prefers an in-flight patch over a verified one", () => {
    expect(
      pickLatestStudioPatch([
        { id: "v", title: "done", status: "VERIFIED" },
        { id: "p", title: "open", status: "PROPOSED" },
      ]),
    ).toEqual({ id: "p", title: "open", status: "PROPOSED" });
  });
});
