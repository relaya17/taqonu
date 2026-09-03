import { describe, expect, it } from "vitest";
import {
  canTransitionSupervisedProcess,
  mapCivioEventToSupervisedState,
} from "./supervised-process.js";

describe("supervised process lifecycle", () => {
  it("maps Civio process events onto CREATED → RUNNING → COMPLETED", () => {
    expect(mapCivioEventToSupervisedState("civio.process.started")).toBe("CREATED");
    expect(mapCivioEventToSupervisedState("civio.rights.answered")).toBe("RUNNING");
    expect(mapCivioEventToSupervisedState("civio.process.completed")).toBe("COMPLETED");
    expect(mapCivioEventToSupervisedState("civio.legal.ai.failed")).toBe("FAILED");
  });

  it("allows the minimum forward lifecycle and rejects regression", () => {
    expect(canTransitionSupervisedProcess("CREATED", "RUNNING")).toBe(true);
    expect(canTransitionSupervisedProcess("RUNNING", "COMPLETED")).toBe(true);
    expect(canTransitionSupervisedProcess("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionSupervisedProcess("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionSupervisedProcess("FAILED", "CREATED")).toBe(false);
    expect(canTransitionSupervisedProcess("RUNNING", "CREATED")).toBe(false);
  });
});
