import { describe, expect, it } from "vitest";
import {
  highlightStudioLine,
  offsetForStudioLine,
  studioLineCount,
  studioSyntaxLanguage,
} from "./studio-syntax";

describe("studioSyntaxLanguage", () => {
  it("maps known API hints and falls back to plaintext", () => {
    expect(studioSyntaxLanguage("typescript")).toBe("typescript");
    expect(studioSyntaxLanguage("json")).toBe("json");
    expect(studioSyntaxLanguage("unknown")).toBe("plaintext");
    expect(studioSyntaxLanguage(null)).toBe("plaintext");
  });
});

describe("highlightStudioLine", () => {
  it("marks TypeScript keywords and strings", () => {
    const tokens = highlightStudioLine(
      'export const name = "atlas";',
      "typescript",
    );
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "export")).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "const")).toBe(
      true,
    );
    expect(tokens.some((t) => t.kind === "string" && t.text === '"atlas"')).toBe(
      true,
    );
  });

  it("treats // comments as a single comment token", () => {
    const tokens = highlightStudioLine("  // keep", "javascript");
    expect(tokens).toEqual([{ kind: "comment", text: "  // keep" }]);
  });

  it("does not invent a language service — plaintext stays plain", () => {
    const tokens = highlightStudioLine("const x = 1", null);
    expect(tokens).toEqual([{ kind: "plain", text: "const x = 1" }]);
  });
});

describe("studio line helpers", () => {
  it("counts lines and maps line numbers to offsets", () => {
    expect(studioLineCount("")).toBe(1);
    expect(studioLineCount("a\nb\nc")).toBe(3);
    expect(offsetForStudioLine("a\nb\nc", 1)).toBe(0);
    expect(offsetForStudioLine("a\nb\nc", 2)).toBe(2);
    expect(offsetForStudioLine("a\nb\nc", 3)).toBe(4);
  });
});
