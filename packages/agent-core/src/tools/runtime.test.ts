import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  executeTool,
  listRegisteredTools,
  registerTool,
  resetToolRegistryForTests,
  resolveInsideRoot,
  type ToolExecutionContext,
} from "./runtime.js";
import { registerFilesystemTools } from "./fs-tools.js";

/**
 * A complete correlation chain for the policy tests.
 *
 * `executeTool()` denies any call whose chain is incomplete (Invariant 10),
 * so every call below needs one. These tests predate the chain and were
 * passing a bare `{ projectRoot }`; the compiler never objected because
 * `src/**\/*.test.ts` is excluded from tsconfig.json, so the omission only
 * surfaced at runtime. `executionId` and `toolCallId` stay empty on purpose
 * — the Runtime layer owns those and fills them in during `executeTool()`.
 */
function ctx(projectRoot: string): ToolExecutionContext {
  return {
    projectRoot,
    correlation: {
      requestId: "req_test",
      agentId: "agent_test",
      proposalId: "prop_test",
      governanceDecisionId: "gov_test",
      authorizationId: "auth_test",
      executionId: "",
      toolCallId: "",
    },
  };
}

describe("Tool Runtime — containment (resolveInsideRoot)", () => {
  const root = "/srv/app";

  it("accepts a plain relative path inside the root", () => {
    // Compare against a RESOLVED path rather than a POSIX literal: on
    // Windows `resolve()` yields "C:\\srv\\app\\src\\index.ts", so a
    // hardcoded "/srv/app/..." made this test pass on Linux/macOS and fail
    // on Windows — a platform bug in the test, not in the containment logic.
    expect(resolveInsideRoot(root, "src/index.ts")).toEqual({
      ok: true,
      path: resolve(root, "src/index.ts"),
    });
  });

  it("rejects traversal that escapes the root", () => {
    const result = resolveInsideRoot(root, "src/../../etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("rejects an absolute path outright", () => {
    const result = resolveInsideRoot(root, "/etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("rejects a sibling directory whose name merely PREFIXES the root", () => {
    // A naive `startsWith("/srv/app")` check would wrongly accept
    // "/srv/app-evil". This is why containment compares path segments.
    const result = resolveInsideRoot(root, "../app-evil/secrets.txt");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(resolveInsideRoot(root, "   ").ok).toBe(false);
  });
});

describe("Tool Runtime — policy enforcement", () => {
  beforeEach(() => resetToolRegistryForTests());
  afterEach(() => resetToolRegistryForTests());

  it("DENIES a tool that has no ToolPolicy, even when an implementation exists", async () => {
    // Fail closed: registering an implementation must not be enough to make
    // a tool reachable. This is the single most important property here.
    registerTool({
      name: "totally.unpoliced",
      run: async () => "should never run",
    });

    const result = await executeTool("totally.unpoliced", {}, ctx("/tmp"));
    expect(result.status).toBe("DENIED");
    if (result.status !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toContain("No ToolPolicy");
  });

  it("DENIES a policed tool that has no registered implementation", async () => {
    const result = await executeTool("fs.read_file", { path: "a.txt" }, ctx("/tmp"));
    expect(result.status).toBe("DENIED");
  });

  it("returns APPROVAL_REQUIRED and does NOT run a tool whose policy requires approval", async () => {
    let ran = false;
    registerTool({
      name: "fs.write_patch",
      run: async () => {
        ran = true;
        return "patched";
      },
    });

    const result = await executeTool("fs.write_patch", {}, ctx("/tmp"));
    expect(result.status).toBe("APPROVAL_REQUIRED");
    // The load-bearing assertion: the side effect never happened.
    expect(ran).toBe(false);
  });

  it("TIMES OUT a tool that exceeds its policy timeout", async () => {
    // fs.read_file's policy timeout is 10_000ms. Fake timers let this assert
    // the real mechanism instead of merely observing that the call has not
    // returned yet — an earlier version of this test did the latter while
    // claiming to test the former.
    vi.useFakeTimers();
    try {
      registerTool({
        name: "fs.read_file",
        run: () =>
          new Promise<string>(() => {
            /* never settles */
          }),
      });

      const pending = executeTool("fs.read_file", { path: "a" }, ctx("/tmp"));
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await pending;

      expect(result.status).toBe("TIMEOUT");
      if (result.status !== "TIMEOUT") throw new Error("expected TIMEOUT");
      expect(result.timeoutMs).toBe(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a tool error as ERROR rather than throwing", async () => {
    registerTool({
      name: "fs.read_file",
      run: async () => {
        throw new Error("boom");
      },
    });
    const result = await executeTool("fs.read_file", { path: "a" }, ctx("/tmp"));
    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") throw new Error("expected ERROR");
    expect(result.reason).toBe("boom");
  });
});

describe("Tool Runtime — filesystem tools against a real directory", () => {
  let root: string;

  beforeEach(() => {
    resetToolRegistryForTests();
    registerFilesystemTools();
    root = mkdtempSync(join(tmpdir(), "atlas-tools-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const answer = 42;\n", "utf8");
    writeFileSync(join(root, "README.md"), "# demo\nanswer lives in src\n", "utf8");
  });

  afterEach(() => {
    resetToolRegistryForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a symlink that points outside the root, even though its path looks contained", async () => {
    // The lexical check passes here on purpose: "escape-hatch/secret.txt" sits
    // under the root by every string comparison. Only canonicalisation catches
    // it, so this is the test that tells `resolveInsideRoot`'s second stage
    // apart from its first.
    const outside = mkdtempSync(join(tmpdir(), "atlas-outside-"));
    writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n", "utf8");

    let linked = false;
    try {
      symlinkSync(outside, join(root, "escape-hatch"), "junction");
      linked = true;
    } catch {
      // Windows refuses symlink creation without the right privilege. Skipping
      // is honest; silently passing would report coverage that never ran.
    }

    if (!linked) {
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    const result = await executeTool(
      "fs.read_file",
      { path: "escape-hatch/secret.txt" },
      ctx(root),
    );
    rmSync(outside, { recursive: true, force: true });

    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") throw new Error("expected ERROR");

    // Assert the CANONICAL-stage message, not the lexical one. The two stages
    // return different strings on purpose (`runtime.ts:208` vs `:233`), and
    // only the second can have produced this refusal — the path is contained
    // by every string comparison, so matching the generic "escapes the project
    // root" here would pass even if stage two had been deleted.
    expect(result.reason).toContain("via symlink or junction");
    expect(result.reason).toContain("outside the project root");
  });

  it("bounds a walk deeper than MAX_WALK_DEPTH, and says so instead of truncating quietly", async () => {
    // 20 nested levels against a cap of 12. The needle sits at the bottom, so
    // a walk that reached it would prove the cap did nothing.
    let deep = root;
    for (let i = 0; i < 20; i += 1) {
      deep = join(deep, `level${i}`);
      mkdirSync(deep, { recursive: true });
    }
    writeFileSync(join(deep, "buried.ts"), "const needle_at_the_bottom = 1;\n", "utf8");

    const result = await executeTool(
      "fs.search_repo",
      { query: "needle_at_the_bottom" },
      ctx(root),
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");

    // The cap held: the buried file was never reached.
    expect(result.output).not.toContain("buried.ts");

    // And the caller is told the result is partial. A clipped answer that
    // reads like a complete one is the failure mode this reports against —
    // an agent would otherwise conclude the string does not exist in the repo.
    expect(result.output).toContain("capped");
    expect(result.output).toContain("depth 12");
  });

  it("reports no cap when the whole tree fits inside the limits", async () => {
    // The counterpart to the test above: without it, a bug that always
    // appended the cap note would still pass.
    const result = await executeTool("fs.search_repo", { query: "answer" }, ctx(root));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.output).toContain("src/index.ts");
    expect(result.output).not.toContain("capped");
  });

  it("registers exactly the three read-only tools", () => {
    expect(listRegisteredTools()).toEqual([
      "fs.read_directory",
      "fs.read_file",
      "fs.search_repo",
    ]);
  });

  it("reads a file inside the project root", async () => {
    const result = await executeTool("fs.read_file", { path: "src/index.ts" }, ctx(root));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.output).toContain("answer = 42");
  });

  it("refuses to read outside the project root", async () => {
    const result = await executeTool(
      "fs.read_file",
      { path: "../../../etc/passwd" },
      ctx(root),
    );
    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") throw new Error("expected ERROR");
    expect(result.reason).toContain("escapes the project root");
  });

  it("lists a directory", async () => {
    const result = await executeTool("fs.read_directory", { path: "." }, ctx(root));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.output).toContain("README.md");
    expect(result.output).toContain("src");
  });

  it("searches file contents and reports file:line", async () => {
    const result = await executeTool("fs.search_repo", { query: "answer" }, ctx(root));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.output).toContain("src/index.ts:1");
  });

  it("DENIES output that contains a secret, even from a READ_ONLY tool", async () => {
    // secretsAccess: "NONE" is enforced on the OUTPUT, not merely assumed of
    // the tool — a .env committed into a repo is exactly this case.
    writeFileSync(join(root, ".env"), "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n", "utf8");
    const result = await executeTool("fs.read_file", { path: ".env" }, ctx(root));
    expect(result.status).toBe("DENIED");
    if (result.status !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toContain("secret");
  });
});
