import { describe, expect, it } from "vitest";
import { agentRunSchema, createAgentRunSchema } from "./agent-run.schema.js";

describe("createAgentRunSchema", () => {
  it("accepts the minimal valid payload and defaults mode to READ", () => {
    const parsed = createAgentRunSchema.parse({ userRequest: "hello" });
    expect(parsed.mode).toBe("READ");
  });

  it("rejects an empty userRequest", () => {
    expect(() => createAgentRunSchema.parse({ userRequest: "" })).toThrow();
  });

  it("accepts exactly 10000 chars and rejects 10001", () => {
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "x".repeat(10000) }),
    ).not.toThrow();
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "x".repeat(10001) }),
    ).toThrow();
  });

  it("rejects a mode outside the MVP set (WRITE/APPROVE/VERIFY are not MVP modes)", () => {
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", mode: "WRITE" }),
    ).toThrow();
  });

  it("only accepts agent-kind aiProviderId values, not assist-kind ones", () => {
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", aiProviderId: "claude-haiku" }),
    ).not.toThrow();
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", aiProviderId: "local-checklist" }),
    ).toThrow();
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", aiProviderId: "gpt-4o-vision" }),
    ).toThrow();
  });

  it("rejects an unknown engineeringMode", () => {
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", engineeringMode: "rewrite-everything" }),
    ).toThrow();
  });

  it("projectId accepts null, a valid uuid, or omission — but not an arbitrary string", () => {
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", projectId: null }),
    ).not.toThrow();
    expect(() =>
      createAgentRunSchema.parse({
        userRequest: "hi",
        projectId: "00000000-0000-4000-8000-000000000000",
      }),
    ).not.toThrow();
    expect(() =>
      createAgentRunSchema.parse({ userRequest: "hi", projectId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("agentRunSchema", () => {
  const base = {
    id: "00000000-0000-4000-8000-000000000000",
    projectId: null,
    mode: "READ" as const,
    status: "SUCCEEDED" as const,
    userRequest: "hello",
    answer: "hi there",
    epistemicState: "INFERRED" as const,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    createdBy: "user",
  };

  it("accepts a fully-formed run", () => {
    expect(() => agentRunSchema.parse(base)).not.toThrow();
  });

  it("requires isoDateTimeSchema fields to include a timezone offset", () => {
    expect(() =>
      agentRunSchema.parse({ ...base, startedAt: "2026-01-01T00:00:00" }),
    ).toThrow();
  });

  it("allows a null answer and null completedAt (run still in progress)", () => {
    expect(() =>
      agentRunSchema.parse({ ...base, answer: null, completedAt: null }),
    ).not.toThrow();
  });

  it("rejects a status outside the documented state machine", () => {
    expect(() => agentRunSchema.parse({ ...base, status: "DONE" })).toThrow();
  });
});
