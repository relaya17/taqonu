import { describe, expect, it } from "vitest";
import {
  listEngineeringLessons,
  listImprovementRules,
  matchLessonsForRequest,
  recordEngineeringLesson,
  runSelfImprovement,
} from "./memory.js";

describe("engineering memory (P9/P10)", () => {
  it("seeds at least the built-in webhook + authz lessons", () => {
    const lessons = listEngineeringLessons();
    expect(lessons.length).toBeGreaterThanOrEqual(2);
    expect(lessons.some((l) => l.pattern === "WEBHOOK_IDEMPOTENCY")).toBe(true);
  });

  it("matches lessons for webhook/auth-flavored requests", () => {
    expect(matchLessonsForRequest("please review the webhook idempotency")).toContain(
      "WEBHOOK_IDEMPOTENCY",
    );
    expect(matchLessonsForRequest("check auth defense in depth")).toContain(
      "AUTHZ_DEFENSE",
    );
  });

  it("returns no matches for an unrelated request", () => {
    expect(matchLessonsForRequest("what color should the button be")).toEqual([]);
  });

  it("recordEngineeringLesson increments occurrences on repeat pattern instead of duplicating", () => {
    const before = listEngineeringLessons().length;
    const first = recordEngineeringLesson({
      pattern: "TEST_PATTERN_UNIQUE_1",
      title: "t",
      summary: "s",
    });
    expect(first.occurrences).toBe(1);
    const second = recordEngineeringLesson({
      pattern: "TEST_PATTERN_UNIQUE_1",
      title: "t",
      summary: "s2",
    });
    expect(second.occurrences).toBe(2);
    expect(second.id).toBe(first.id);
    expect(listEngineeringLessons().length).toBe(before + 1);
  });

  it("runSelfImprovement creates a rule once a pattern occurs >= 2 times, and is idempotent", () => {
    recordEngineeringLesson({ pattern: "TEST_PATTERN_UNIQUE_2", title: "t", summary: "s" });
    recordEngineeringLesson({ pattern: "TEST_PATTERN_UNIQUE_2", title: "t", summary: "s" });
    const result = runSelfImprovement();
    expect(result.created.some((r) => r.pattern === "TEST_PATTERN_UNIQUE_2")).toBe(true);

    const rulesAfterFirst = listImprovementRules().length;
    const second = runSelfImprovement();
    expect(second.created.some((r) => r.pattern === "TEST_PATTERN_UNIQUE_2")).toBe(false);
    expect(listImprovementRules().length).toBe(rulesAfterFirst);
  });

  it("routes AUTH/WEBHOOK patterns to SECURITY auto-check agents", () => {
    recordEngineeringLesson({ pattern: "TEST_AUTH_PATTERN_3", title: "t", summary: "s" });
    recordEngineeringLesson({ pattern: "TEST_AUTH_PATTERN_3", title: "t", summary: "s" });
    runSelfImprovement();
    const rule = listImprovementRules().find((r) => r.pattern === "TEST_AUTH_PATTERN_3");
    expect(rule?.autoCheckAgents).toContain("SECURITY");
  });
});
