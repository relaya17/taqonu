import { describe, expect, it } from "vitest";
import { createTaskPlan } from "./task-plan.js";
import { EvidenceBus } from "./evidence-bus.js";
import { runSpecialist } from "./specialists.js";

describe("runSpecialist", () => {
  it("ORCHESTRATOR always completes and publishes an allocation claim", () => {
    const plan = createTaskPlan({ request: "review the architecture" });
    const bus = new EvidenceBus("t1");
    const result = runSpecialist({
      agentId: "ORCHESTRATOR",
      plan,
      request: "review the architecture",
      bus,
      knowledgeHitIds: [],
      lessons: [],
    });
    expect(result.status).toBe("COMPLETED");
    expect(bus.listItems()).toHaveLength(1);
  });

  it("refuses with INSUFFICIENT_EVIDENCE for a thin request with no knowledge package", () => {
    const plan = createTaskPlan({ request: "hi" });
    const bus = new EvidenceBus("t2");
    const result = runSpecialist({
      agentId: "ARCHITECT",
      plan,
      request: "hi",
      bus,
      knowledgeHitIds: [],
      lessons: [],
    });
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(bus.listItems()[0]?.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("SECURITY publishes Sentinel security observations verbatim when provided", () => {
    const plan = createTaskPlan({ request: "review auth security" });
    const bus = new EvidenceBus("t3");
    const result = runSpecialist({
      agentId: "SECURITY",
      plan,
      request: "review auth security",
      bus,
      knowledgeHitIds: [],
      lessons: [],
      securityObservation: { claims: ["finding A"], evidenceRefs: ["ref1"] },
    });
    expect(result.status).toBe("COMPLETED");
    const item = bus.listItems().find((i) => i.agentId === "SECURITY");
    expect(item?.claim).toContain("finding A");
    expect(item?.sourceType).toBe("SECURITY_ADVISORY");
  });

  it("OMISSION_DETECTOR always completes with a Constitution-checklist claim", () => {
    const plan = createTaskPlan({ request: "build a booking app" });
    const bus = new EvidenceBus("t4");
    const result = runSpecialist({
      agentId: "OMISSION_DETECTOR",
      plan,
      request: "build a booking app",
      bus,
      knowledgeHitIds: [],
      lessons: [],
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.summary).toMatch(/Constitution/);
  });

  it("a non-thin request with a knowledge package completes and cites hits + lessons", () => {
    const plan = createTaskPlan({ request: "harden the webhook auth flow" });
    const bus = new EvidenceBus("t5");
    const result = runSpecialist({
      agentId: "SECURITY",
      plan,
      request: "harden the webhook auth flow",
      bus,
      knowledgeHitIds: ["hit_1", "hit_2"],
      lessons: ["WEBHOOK_IDEMPOTENCY"],
    });
    expect(result.status).toBe("COMPLETED");
    const item = bus.listItems().find((i) => i.agentId === "SECURITY");
    expect(item?.claim).toContain("lessons=WEBHOOK_IDEMPOTENCY");
  });
});
