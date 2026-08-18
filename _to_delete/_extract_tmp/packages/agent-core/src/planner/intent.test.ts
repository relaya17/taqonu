import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent.js";

describe("classifyIntent", () => {
  it("classifies write-flavored requests as WRITE_CHANGE requiring approval", () => {
    const intent = classifyIntent("please commit and push this fix");
    expect(intent.kind).toBe("WRITE_CHANGE");
    expect(intent.suggestedMode).toBe("WRITE");
    expect(intent.requiresApproval).toBe(true);
  });

  it("classifies plan/fix-flavored requests as PLAN_CHANGE requiring approval", () => {
    const intent = classifyIntent("how should I fix the login bug?");
    expect(intent.kind).toBe("PLAN_CHANGE");
    expect(intent.suggestedMode).toBe("PLAN");
    expect(intent.requiresApproval).toBe(true);
  });

  it("classifies resume-flavored requests (English + Hebrew) as RESUME", () => {
    expect(classifyIntent("let's continue where we left off").kind).toBe("RESUME");
    expect(classifyIntent("המשך מאיפה שעצרנו").kind).toBe("RESUME");
  });

  it("classifies portfolio-wide requests as PORTFOLIO_HEALTH", () => {
    expect(classifyIntent("compare architecture across all my projects").kind).toBe(
      "PORTFOLIO_HEALTH",
    );
  });

  it("classifies QA-flavored requests (English + Hebrew + Arabic) as QA_RUN", () => {
    expect(classifyIntent("run the regression test suite").kind).toBe("QA_RUN");
    expect(classifyIntent("תבדוק את איכות הקוד").kind).toBe("QA_RUN");
  });

  it("classifies research-flavored requests as RESEARCH", () => {
    expect(classifyIntent("what is the current official API for this?").kind).toBe(
      "RESEARCH",
    );
  });

  it("falls back to ANALYZE for a non-empty request matching no other pattern", () => {
    const intent = classifyIntent("random unrelated text");
    expect(intent.kind).toBe("ANALYZE");
    expect(intent.requiresApproval).toBe(false);
  });

  it("classifies an empty/whitespace-only request as UNKNOWN", () => {
    expect(classifyIntent("   ").kind).toBe("UNKNOWN");
    expect(classifyIntent("").kind).toBe("UNKNOWN");
  });

  it("never requires approval for READ-like intents (RESUME/QA_RUN/PORTFOLIO_HEALTH/RESEARCH)", () => {
    expect(classifyIntent("continue where we left off").requiresApproval).toBe(false);
    expect(classifyIntent("run the qa suite").requiresApproval).toBe(false);
  });
});
