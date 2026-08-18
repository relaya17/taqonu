import { describe, expect, it } from "vitest";
import { runIntelligenceKernel } from "./run.js";

describe("runIntelligenceKernel (P1-P7 end-to-end)", () => {
  it("refuses confidently for an ultra-thin request (INSUFFICIENT_EVIDENCE, not a hallucinated APPROVE)", () => {
    const result = runIntelligenceKernel({ request: "hi" });
    expect(result.judge?.decision).not.toBe("APPROVE");
  });

  it("produces a coherent result shape for a normal request", () => {
    const result = runIntelligenceKernel({ request: "how do I add rate limiting to my API?" });
    expect(result.plan.objective).toContain("rate limiting");
    expect(result.evidenceItems.length).toBeGreaterThan(0);
    expect(result.traceId).toMatch(/^kern_/);
    expect(result.judge).not.toBeNull();
  });

  it("runJudge=false skips the Judge phase entirely", () => {
    const result = runIntelligenceKernel({
      request: "how do I add rate limiting to my API?",
      runJudge: false,
    });
    expect(result.judge).toBeNull();
  });

  it("runSimulation=false skips the simulation phase", () => {
    const result = runIntelligenceKernel({
      request: "deploy to production",
      runSimulation: false,
    });
    expect(result.simulation).toBeNull();
  });

  it("recommends the engineering-loop bridge only when a write-capable agent or simulation is required", () => {
    const writeReq = runIntelligenceKernel({ request: "implement and fix the payments code" });
    const readReq = runIntelligenceKernel({ request: "show me the roadmap", maxAgents: 1 });
    if (
      writeReq.plan.requiredAgents.some((a) =>
        ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"].includes(a),
      )
    ) {
      expect(writeReq.engineeringLoopBridge?.recommended).toBe(true);
    }
    if (
      !readReq.plan.simulationRequired &&
      !readReq.plan.requiredAgents.some((a) =>
        ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"].includes(a),
      )
    ) {
      expect(readReq.engineeringLoopBridge?.recommended).toBe(false);
    }
  });

  it("passes through an externally-observed SECURITY finding into the Evidence Bus", () => {
    const result = runIntelligenceKernel({
      request: "review auth security for the API",
      securityObservation: { claims: ["sql injection risk in login"], evidenceRefs: ["scan_1"] },
    });
    const securityItem = result.evidenceItems.find((i) => i.agentId === "SECURITY");
    expect(securityItem?.claim).toContain("sql injection risk in login");
  });

  it("never throws for a request right at the 8000-char API boundary", () => {
    const longRequest = "review ".repeat(2000).slice(0, 8000);
    expect(() => runIntelligenceKernel({ request: longRequest })).not.toThrow();
  });

  it("is deterministic in shape across runs with the same input (ids differ, structure does not)", () => {
    const a = runIntelligenceKernel({ request: "check accessibility of the login form" });
    const b = runIntelligenceKernel({ request: "check accessibility of the login form" });
    expect(a.plan.requiredAgents).toEqual(b.plan.requiredAgents);
    expect(a.judge?.decision).toBe(b.judge?.decision);
    expect(a.id).not.toBe(b.id);
  });
});
