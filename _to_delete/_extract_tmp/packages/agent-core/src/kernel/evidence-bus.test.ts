import { describe, expect, it } from "vitest";
import { EvidenceBus } from "./evidence-bus.js";

describe("EvidenceBus", () => {
  it("publishes a claim and lists it back", () => {
    const bus = new EvidenceBus("trace_1");
    const item = bus.publishClaim({
      claim: "example claim",
      source: "unit-test",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.8,
      confidence: 0.8,
      agentId: "ARCHITECT",
    });
    expect(bus.listItems()).toHaveLength(1);
    expect(bus.listItems()[0]?.id).toBe(item.id);
    expect(bus.listEvents()).toHaveLength(1);
    expect(bus.listEvents()[0]?.type).toBe("evidence.published");
  });

  it("marks low-authority or low-confidence claims INSUFFICIENT_EVIDENCE and emits evidence.insufficient", () => {
    const bus = new EvidenceBus("trace_2");
    const lowAuthority = bus.publishClaim({
      claim: "weak claim",
      source: "unit-test",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.1,
      confidence: 0.9,
      agentId: "ARCHITECT",
    });
    expect(lowAuthority.epistemicState).toBe("INSUFFICIENT_EVIDENCE");

    const lowConfidence = bus.publishClaim({
      claim: "unsure claim",
      source: "unit-test",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.9,
      confidence: 0.1,
      agentId: "ARCHITECT",
    });
    expect(lowConfidence.epistemicState).toBe("INSUFFICIENT_EVIDENCE");

    const insufficientEvents = bus
      .listEvents()
      .filter((e) => e.type === "evidence.insufficient");
    expect(insufficientEvents).toHaveLength(2);
  });

  it("gives each claim a unique id and a stable-looking contentHash", () => {
    const bus = new EvidenceBus("trace_3");
    const a = bus.publishClaim({
      claim: "same text",
      source: "same-source",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.7,
      confidence: 0.7,
      agentId: "ARCHITECT",
    });
    const b = bus.publishClaim({
      claim: "same text",
      source: "same-source",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.7,
      confidence: 0.7,
      agentId: "ARCHITECT",
    });
    expect(a.id).not.toBe(b.id);
    expect(a.contentHash).toHaveLength(24);
  });

  it("hasSufficientEvidence ignores LLM_INFERENCE and INSUFFICIENT_EVIDENCE items", () => {
    const bus = new EvidenceBus("trace_4");
    bus.publishClaim({
      claim: "llm guess",
      source: "model",
      sourceType: "LLM_INFERENCE",
      authorityScore: 0.9,
      confidence: 0.9,
      agentId: "ARCHITECT",
    });
    expect(bus.hasSufficientEvidence(0.4, 1)).toBe(false);

    bus.publishClaim({
      claim: "grounded fact",
      source: "repo-scan",
      sourceType: "REPOSITORY",
      authorityScore: 0.9,
      confidence: 0.9,
      agentId: "ARCHITECT",
    });
    expect(bus.hasSufficientEvidence(0.4, 1)).toBe(true);
  });

  it("publish() dedupes items into the items map by id but keeps every event", () => {
    const bus = new EvidenceBus("trace_5");
    bus.publishClaim({
      claim: "one",
      source: "s",
      sourceType: "HUMAN",
      authorityScore: 0.9,
      confidence: 0.9,
      agentId: null,
    });
    bus.publish({ type: "simulation.completed", payload: { ok: true } });
    expect(bus.listEvents()).toHaveLength(2);
    expect(bus.listItems()).toHaveLength(1);
  });
});
