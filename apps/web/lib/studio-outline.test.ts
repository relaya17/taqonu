import { describe, expect, it } from "vitest";
import { extractStudioOutline, studioFileBreadcrumbs } from "./studio-outline";

describe("extractStudioOutline", () => {
  it("extracts functions, types, and routes with line numbers", () => {
    const outline = extractStudioOutline(
      [
        "export function createProposal() {}",
        "export interface AskResult {}",
        'app.get("/api/v1/studio/search", async () => {});',
      ].join("\n"),
    );
    expect(outline).toEqual([
      { kind: "function", name: "createProposal", line: 1 },
      { kind: "type", name: "AskResult", line: 2 },
      { kind: "route", name: "GET /api/v1/studio/search", line: 3 },
    ]);
  });

  it("does not invent symbols in plaintext", () => {
    expect(extractStudioOutline("just a comment")).toEqual([]);
  });
});

describe("studioFileBreadcrumbs", () => {
  it("splits a workspace path", () => {
    expect(studioFileBreadcrumbs("apps/web/app/page.tsx")).toEqual([
      "apps",
      "web",
      "app",
      "page.tsx",
    ]);
  });
});
