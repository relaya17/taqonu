import { describe, expect, it } from "vitest";
import {
  mergeStudioProblems,
  problemsFromGateNodes,
  problemsFromSentinelFindings,
  problemsFromTestRun,
  studioProblemCanOpenFile,
  studioProblemRemediationId,
} from "./studio-problems";

describe("problemsFromSentinelFindings", () => {
  it("copies path and line when the finding has them", () => {
    const problems = problemsFromSentinelFindings([
      {
        id: "sec-1",
        title: "Secret",
        detail: "Possible API key",
        severity: "HIGH",
        kind: "generic_api_key",
        path: "src/config.ts",
        line: 12,
      },
    ]);
    expect(problems).toEqual([
      {
        id: "sentinel:sec-1",
        source: "sentinel",
        severity: "HIGH",
        message: "Possible API key",
        file: "src/config.ts",
        line: 12,
        column: null,
        code: "generic_api_key",
      },
    ]);
    expect(studioProblemCanOpenFile(problems[0]!)).toBe(true);
  });

  it("preserves leaked-credential.ts line 1 for a Sentinel secret", () => {
    const problems = problemsFromSentinelFindings([
      {
        id: "secret:leaked-credential.ts:aws_access_key:1",
        title: "Possible AWS access key id",
        detail: "Potential secret in leaked-credential.ts:1. Value redacted.",
        severity: "CRITICAL",
        kind: "aws_access_key",
        path: "leaked-credential.ts",
        line: 1,
      },
    ]);
    expect(problems[0]?.file).toBe("leaked-credential.ts");
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.severity).toBe("CRITICAL");
    expect(studioProblemCanOpenFile(problems[0]!)).toBe(true);
  });

  it("does not invent file location when Sentinel omitted it", () => {
    const problems = problemsFromSentinelFindings([
      {
        id: "pack-1",
        title: "Pack finding",
        severity: "MEDIUM",
      },
    ]);
    expect(problems[0]?.file).toBeNull();
    expect(problems[0]?.line).toBeNull();
    expect(studioProblemCanOpenFile(problems[0]!)).toBe(false);
  });
});

describe("problemsFromGateNodes", () => {
  it("omits PASS/WAIVED and never invents a file path", () => {
    const problems = problemsFromGateNodes([
      {
        id: "secrets-clean",
        title: "Secrets",
        status: "PASS",
        blockerReason: null,
      },
      {
        id: "conflicts-resolved",
        title: "Conflicts",
        status: "BLOCKED",
        blockerReason: "1 open conflict(s). Resolve by Source Authority.",
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.source).toBe("gate");
    expect(problems[0]?.file).toBeNull();
    expect(problems[0]?.line).toBeNull();
    expect(problems[0]?.message).toContain("1 open conflict");
  });
});

describe("mergeStudioProblems", () => {
  it("dedupes by id and does not fabricate extra rows", () => {
    const a = problemsFromSentinelFindings([
      { id: "sec-1", title: "A", severity: "HIGH" },
    ]);
    const merged = mergeStudioProblems(a, a);
    expect(merged).toHaveLength(1);
  });
});

describe("problemsFromTestRun", () => {
  it("does not invent PASS from a missing run", () => {
    expect(problemsFromTestRun(null, "p1")).toEqual([]);
    expect(problemsFromTestRun({ status: "EXITED", passed: true, commandId: "vitest.run" }, "p1")).toEqual([]);
  });

  it("records UNAVAILABLE as INFO, not PASS", () => {
    const problems = problemsFromTestRun(
      {
        commandId: "vitest.run",
        status: "UNAVAILABLE",
        denial: "UNAVAILABLE",
        reason: "No workspace-local Vitest binary",
        passed: false,
      },
      "p1",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.source).toBe("test");
    expect(problems[0]?.severity).toBe("INFO");
    expect(problems[0]?.file).toBeNull();
  });
});

describe("studioProblemRemediationId", () => {
  it("binds only Sentinel findings, never gates or tests", () => {
    const sentinel = problemsFromSentinelFindings([
      { id: "sec-1", title: "Secret", path: "a.ts", line: 1 },
    ])[0]!;
    expect(studioProblemRemediationId(sentinel)).toBe("sec-1");
    const gate = problemsFromGateNodes([
      {
        id: "eval",
        title: "Eval",
        status: "FAIL",
        blockerReason: "blocked",
      },
    ])[0]!;
    expect(studioProblemRemediationId(gate)).toBeNull();
  });
});
