import { describe, expect, it } from "vitest";
import type { DomainEvent, Memory } from "@atlas/shared";
import { detectRecurringFailures } from "./recurring-failure";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";

function event(
  partial: Partial<DomainEvent> & Pick<DomainEvent, "id" | "payload">,
): DomainEvent {
  return {
    type: "evaluation.completed",
    occurredAt: "2026-09-26T00:00:00.000Z",
    ownerId: OWNER,
    projectId: PROJECT,
    correlationId: "55555555-5555-4555-8555-555555555555",
    causationId: null,
    epistemicState: "CONFLICTED",
    ...partial,
  };
}

function memory(partial: Partial<Memory> & Pick<Memory, "id" | "statement" | "epistemicState">): Memory {
  return {
    ownerId: OWNER,
    type: "LESSON",
    projectId: PROJECT,
    reason: [],
    status: "ACTIVE",
    confidence: 0.4,
    category: "EVENT_MEMORY",
    observationMode: "INFERRED",
    source: "test",
    sourceType: "USER",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: null,
    validUntil: null,
    observedAt: null,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    createdBy: "test",
    scope: "PROJECT",
    priority: "MEDIUM",
    ...partial,
  };
}

describe("detectRecurringFailures", () => {
  it("recommends from two verified failures and keeps the conclusion INFERRED", () => {
    const first = "66666666-6666-4666-8666-666666666666";
    const second = "77777777-7777-4777-8777-777777777777";
    const remembered = memory({
      id: "88888888-8888-4888-8888-888888888888",
      statement: "auth-timeout has failed before",
      epistemicState: "INFERRED",
      sourceId: "auth-timeout",
    });
    const items = detectRecurringFailures({
      ownerId: OWNER,
      projectId: PROJECT,
      events: [
        event({
          id: first,
          occurredAt: "2026-09-26T00:00:00.000Z",
          payload: { ok: false, sourceIssueId: "auth-timeout", patchVerifyStatus: "FAIL" },
        }),
        event({
          id: second,
          occurredAt: "2026-09-26T01:00:00.000Z",
          payload: { ok: false, sourceIssueId: "auth-timeout", patchVerifyStatus: "FAIL" },
        }),
      ],
      memories: [remembered],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.epistemicState).toBe("INFERRED");
    expect(items[0]?.occurrences).toBe(2);
    expect(items[0]?.eventIds).toEqual([first, second]);
    expect(items[0]?.memories[0]?.epistemicState).toBe("INFERRED");
    expect(items[0]?.evidenceRefs.map((ref) => ref.id)).toEqual([
      first,
      second,
      remembered.id,
    ]);
    expect(items[0]?.recommendation).not.toMatch(/\bFACT\b/);
    expect(items[0]?.recommendation).not.toMatch(/\bCONFIRMED\b/);
  });

  it("does not treat a single failure, an inferred event, or another owner as recurrence", () => {
    const items = detectRecurringFailures({
      ownerId: OWNER,
      projectId: PROJECT,
      events: [
        event({
          id: "99999999-9999-4999-8999-999999999991",
          payload: { ok: false, sourceIssueId: "once" },
        }),
        event({
          id: "99999999-9999-4999-8999-999999999992",
          epistemicState: "INFERRED",
          payload: { ok: false, sourceIssueId: "guessed" },
        }),
        event({
          id: "99999999-9999-4999-8999-999999999993",
          epistemicState: "INFERRED",
          payload: { ok: false, sourceIssueId: "guessed" },
        }),
        event({
          id: "99999999-9999-4999-8999-999999999994",
          ownerId: OTHER,
          payload: { ok: false, sourceIssueId: "foreign" },
        }),
        event({
          id: "99999999-9999-4999-8999-999999999995",
          ownerId: OTHER,
          payload: { ok: false, sourceIssueId: "foreign" },
        }),
      ],
      memories: [],
    });
    expect(items).toEqual([]);
  });

  it("cites a VERIFIED memory without promoting the recommendation", () => {
    const items = detectRecurringFailures({
      ownerId: OWNER,
      events: [
        event({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          payload: { ok: false, findingId: "lint-rule" },
        }),
        event({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          payload: { remediationResult: "NOT_FIXED", findingId: "lint-rule" },
        }),
      ],
      memories: [
        memory({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          statement: "lint-rule lesson",
          epistemicState: "VERIFIED",
          projectId: null,
        }),
      ],
    });
    expect(items[0]?.epistemicState).toBe("INFERRED");
    expect(items[0]?.memories[0]?.epistemicState).toBe("VERIFIED");
  });
});
