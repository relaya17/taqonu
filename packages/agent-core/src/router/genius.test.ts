import { describe, expect, it } from "vitest";
import { geniusRoute } from "./genius.js";

describe("geniusRoute", () => {
  it("always includes ORCHESTRATOR", () => {
    expect(geniusRoute("hello").agentIds).toContain("ORCHESTRATOR");
  });

  it("routes security-flavored requests to SECURITY + JUDGE with multi+human hint", () => {
    const route = geniusRoute("we have an auth secret leak, is this a CVE?");
    expect(route.agentIds).toContain("SECURITY");
    expect(route.agentIds).toContain("JUDGE");
    expect(route.modelHint).toBe("multi+human");
  });

  it("routes accessibility requests to ACCESSIBILITY", () => {
    expect(geniusRoute("check wcag contrast and rtl screen reader support").agentIds).toContain(
      "ACCESSIBILITY",
    );
  });

  it("routes test/QA requests to QA and TEST_ENGINEER", () => {
    const route = geniusRoute("improve e2e test coverage and regression suite");
    expect(route.agentIds).toContain("QA");
    expect(route.agentIds).toContain("TEST_ENGINEER");
  });

  it("routes bug/crash requests to DEBUGGER", () => {
    expect(geniusRoute("the app keeps crashing with a stack trace").agentIds).toContain(
      "DEBUGGER",
    );
  });

  it("routes legal/media keywords (Hebrew + English) to LEGAL_MEDIA_COMMS + RESEARCHER + JUDGE", () => {
    const route = geniusRoute("צריך ייעוץ משפטי לגבי תקשורת ומדיה");
    expect(route.agentIds).toContain("LEGAL_MEDIA_COMMS");
    expect(route.agentIds).toContain("RESEARCHER");
    expect(route.agentIds).toContain("JUDGE");
  });

  it("routes build-intent requests to OMISSION_DETECTOR + ARCHITECT + SECURITY", () => {
    const route = geniusRoute("build a new saas app with payments");
    expect(route.agentIds).toContain("OMISSION_DETECTOR");
    expect(route.agentIds).toContain("ARCHITECT");
    expect(route.agentIds).toContain("SECURITY");
  });

  it("falls back to QA when nothing else matched, so there is always >= 1 specialist", () => {
    const route = geniusRoute("asdkjhasdkjh random text with no keywords");
    expect(route.agentIds.length).toBeGreaterThan(1);
    expect(route.agentIds).toContain("QA");
  });

  it("appends JUDGE once agent count exceeds 2, even without explicit security/code triggers", () => {
    const route = geniusRoute("architect review, ui/ux review, and qa regression coverage");
    expect(route.agentIds.filter((a) => a === "JUDGE")).toHaveLength(1);
  });

  it("uses vision hint for screenshot/figma requests (when not security-critical)", () => {
    const route = geniusRoute("review this figma screenshot for layout issues");
    expect(route.modelHint).toBe("vision");
  });
});
