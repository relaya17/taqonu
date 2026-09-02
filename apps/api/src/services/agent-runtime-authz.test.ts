import { beforeEach, describe, expect, it, vi } from "vitest";

// `resolveAgentIdentity` now calls `assertGovernedProjectExists`, which
// reads `osStore.getProject`. Mocked the same way `project-access.test.ts`
// mocks the store, so this stays a real unit test of identity resolution
// rather than depending on a real project being seeded on disk.
const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (id: string) => getProject(id),
  },
}));

const {
  enforceAgentToolAuthorization,
  resolveAgentIdentity,
} = await import("./agent-runtime-authz.js");
type AuthenticatedAgentIdentity = ReturnType<typeof resolveAgentIdentity>;

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  getProject.mockReset();
  // Default: any projectId used by the existing fixtures below resolves to
  // a real project, so tests written before the existence check was added
  // keep testing what they were written to test.
  getProject.mockImplementation((id: string) =>
    id === PROJECT_A || id === PROJECT_B ? { id } : undefined,
  );
});

function identity(
  overrides: Partial<AuthenticatedAgentIdentity> = {},
): AuthenticatedAgentIdentity {
  return {
    agentId: "CODE_ENGINEER",
    ownerId: OWNER_A,
    projectId: PROJECT_A,
    authorityScope: `project:${PROJECT_A}`,
    trustLevel: "LAB",
    runtimeStatus: "ACTIVE",
    ...overrides,
  };
}

describe("P0.2 — identity is resolved server-side, never declared", () => {
  it("resolves a valid catalog agent against a session owner", () => {
    const resolved = resolveAgentIdentity({
      fabricAgentId: "SECURITY",
      sessionOwnerId: OWNER_A,
      projectId: PROJECT_A,
    });
    expect(resolved).toEqual({
      agentId: "SECURITY",
      ownerId: OWNER_A,
      projectId: PROJECT_A,
      authorityScope: `project:${PROJECT_A}`,
      trustLevel: "FULL",
      runtimeStatus: "ACTIVE",
    });
  });

  it("defaults session-backed identity to FULL; LAB is opt-in", () => {
    const full = resolveAgentIdentity({
      fabricAgentId: "RESEARCHER",
      sessionOwnerId: OWNER_A,
      projectId: null,
    });
    expect(full.trustLevel).toBe("FULL");
    const lab = resolveAgentIdentity({
      fabricAgentId: "RESEARCHER",
      sessionOwnerId: OWNER_A,
      projectId: null,
      trustLevel: "LAB",
    });
    expect(lab.trustLevel).toBe("LAB");
  });

  it("REJECTS an agent id that is not in the catalog", () => {
    // An invented agent must not acquire an empty (unconstrained) policy.
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "ROOT_OVERRIDE",
        sessionOwnerId: OWNER_A,
        projectId: null,
      }),
    ).toThrow(/not in the agent catalog/);
  });

  it("REJECTS identity construction without an authenticated session owner", () => {
    expect(() =>
      resolveAgentIdentity({ fabricAgentId: "QA", sessionOwnerId: "", projectId: null }),
    ).toThrow(/authenticated session owner/);
  });
});

describe("Phase 2 — governed-project existence (assertGovernedProjectExists via resolveAgentIdentity)", () => {
  it("ALLOWS a projectId that resolves to a real project", () => {
    getProject.mockReturnValue({ id: PROJECT_A });
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "SECURITY",
        sessionOwnerId: OWNER_A,
        projectId: PROJECT_A,
      }),
    ).not.toThrow();
  });

  it("REJECTS a projectId that does not exist", () => {
    getProject.mockReturnValue(undefined);
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "SECURITY",
        sessionOwnerId: OWNER_A,
        projectId: "99999999-9999-4999-8999-999999999999",
      }),
    ).toThrow(/Project not found/);
  });

  it("ALLOWS projectId: null without requiring any project to exist (project-less/tenant-scoped identity)", () => {
    getProject.mockReturnValue(undefined);
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "SECURITY",
        sessionOwnerId: OWNER_A,
        projectId: null,
      }),
    ).not.toThrow();
    expect(getProject).not.toHaveBeenCalled();
  });

  it("does not apply ownership matching — a real project owned by a different tenant still resolves (existence-only, by design; see project-access.ts doc comment)", () => {
    // OWNER_B's project, referenced by an OWNER_A-session call. This is the
    // deliberate scope boundary from Phase 2 discovery §D/§G: ownership
    // matching is a separate, not-yet-decided question, not a regression.
    getProject.mockReturnValue({ id: PROJECT_B, ownerId: OWNER_B });
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "SECURITY",
        sessionOwnerId: OWNER_A,
        projectId: PROJECT_B,
      }),
    ).not.toThrow();
  });

  it("a nonexistent project blocks identity resolution before any tool authorization can run", () => {
    // No identity is ever returned, so enforceAgentToolAuthorization —
    // which requires an identity as input — cannot be reached at all for
    // this request. Asserted structurally: resolveAgentIdentity itself is
    // what throws, not a downstream gate.
    getProject.mockReturnValue(undefined);
    let identityWasResolved = false;
    try {
      const resolved = resolveAgentIdentity({
        fabricAgentId: "SECURITY",
        sessionOwnerId: OWNER_A,
        projectId: "99999999-9999-4999-8999-999999999999",
      });
      identityWasResolved = Boolean(resolved);
    } catch {
      // expected
    }
    expect(identityWasResolved).toBe(false);
  });
});

describe("P0.2 — anti-impersonation (payload may restate identity, never contradict it)", () => {
  it("DENIES a cross-tenant target in the payload", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity(),
        requestedTool: "analyze_repo",
        payload: { targetOwnerId: OWNER_B },
      }),
    ).toThrow(/cross-tenant boundary escape/);
  });

  it("DENIES a cross-project target in the payload", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity(),
        requestedTool: "analyze_repo",
        payload: { targetProjectId: PROJECT_B },
      }),
    ).toThrow(/cross-project boundary escape/);
  });

  it("DENIES acting as a different agent", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity(),
        requestedTool: "analyze_repo",
        payload: { targetAgentId: "ORCHESTRATOR" },
      }),
    ).toThrow(/act as another agent/);
  });

  it("ALLOWS a payload that merely restates the true identity", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity(),
        requestedTool: "analyze_repo",
        payload: {
          targetOwnerId: OWNER_A,
          targetProjectId: PROJECT_A,
          targetAgentId: "CODE_ENGINEER",
        },
      }),
    ).not.toThrow();
  });

  it("cannot be defeated by declaring a privileged agent, because identity is not a parameter", () => {
    // The attack that a self-comparing guard misses entirely: forge the
    // CONTEXT rather than the payload. Here it is impossible to express —
    // `resolveAgentIdentity` is the only way to obtain an identity, and it
    // takes the owner from the session, not from the request.
    expect(() =>
      resolveAgentIdentity({
        fabricAgentId: "JUDGE",
        sessionOwnerId: OWNER_A,
        projectId: PROJECT_A,
      }),
    ).not.toThrow();

    // Declaring JUDGE does not grant JUDGE's neighbours' tools — the catalog
    // still binds, so escalation buys nothing.
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity({ agentId: "JUDGE" }),
        requestedTool: "apply_patch",
        payload: {},
      }),
    ).toThrow(/explicitly forbidden/);
  });
});

describe("P0.2 — tool authorization enforces the EXISTING catalog", () => {
  it("DENIES a tool that is explicitly in forbiddenTools", () => {
    // JUDGE.forbiddenTools includes apply_patch and write_code.
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity({ agentId: "JUDGE" }),
        requestedTool: "write_code",
      }),
    ).toThrow(/explicitly forbidden/);
  });

  it("DENIES a tool that is simply absent from allowedTools", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity({ agentId: "JUDGE" }),
        requestedTool: "system:root-override",
      }),
    ).toThrow(/not in agent JUDGE's allowedTools/);
  });

  it("ALLOWS a tool the catalog actually grants", () => {
    // JUDGE.allowedTools = ["evaluate", "conflict_scan", "escalate"].
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity({ agentId: "JUDGE" }),
        requestedTool: "evaluate",
      }),
    ).not.toThrow();
  });

  it("DENIES CODE_ENGINEER the un-approved apply path it is forbidden", () => {
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity(),
        requestedTool: "apply_patch_without_approval",
      }),
    ).toThrow(/explicitly forbidden/);
  });

  it("ALLOWS CODE_ENGINEER to propose a patch (its real granted tool)", () => {
    expect(() =>
      enforceAgentToolAuthorization({ identity: identity(), requestedTool: "propose_patch" }),
    ).not.toThrow();
  });

  it("ALLOWS RESEARCHER the catalogued read tools (not a CP-only alias)", () => {
    const researcher = identity({ agentId: "RESEARCHER" });
    for (const tool of ["knowledge_search", "fs.read_file", "fs.read_directory", "fs.search_repo"] as const) {
      expect(() =>
        enforceAgentToolAuthorization({ identity: researcher, requestedTool: tool }),
      ).not.toThrow();
    }
  });

  it("honours no wildcard — '*' is not a grant", () => {
    expect(() =>
      enforceAgentToolAuthorization({ identity: identity(), requestedTool: "*" }),
    ).toThrow(/not in agent CODE_ENGINEER's allowedTools/);
  });

  it("DENIES the ORCHESTRATOR its own forbidden tools too (no privileged exemption)", () => {
    // ORCHESTRATOR.forbiddenTools = ["apply_patch", "exfiltrate"].
    expect(() =>
      enforceAgentToolAuthorization({
        identity: identity({ agentId: "ORCHESTRATOR" }),
        requestedTool: "exfiltrate",
      }),
    ).toThrow(/explicitly forbidden/);
  });
});
