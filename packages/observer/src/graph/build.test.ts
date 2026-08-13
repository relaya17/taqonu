import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import {
  buildSoftwareKnowledgeGraph,
  computeGraphImpact,
  runObserveCycle,
} from "../index.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-graph-"));
  temps.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "gdemo", dependencies: {} }),
    "utf8",
  );
  writeFileSync(
    join(dir, "src", "a.ts"),
    `import { helper } from "./b";\nexport function run() { return helper(); }\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "src", "b.ts"),
    `export function helper() { return 1; }\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "src", "routes.ts"),
    `app.post("/api/bookings", () => {});`,
    "utf8",
  );
  return dir;
}

describe("software knowledge graph", () => {
  it("builds nodes/edges and impact from imports", () => {
    const root = tempWorkspace();
    const graph = buildSoftwareKnowledgeGraph({
      workspaceRoot: root,
      projectSlug: "gdemo",
    });
    expect(graph.nodes.some((n) => n.type === "FILE")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "FUNCTION")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "API")).toBe(true);
    expect(graph.edges.some((e) => e.type === "DEPENDS_ON")).toBe(true);

    const fileA = graph.nodes.find((n) => n.key.endsWith("src/a.ts"));
    expect(fileA).toBeTruthy();
    const impact = computeGraphImpact({
      graph,
      rootNodeId: fileA!.id,
      depth: 3,
      direction: "OUT",
    });
    expect(impact.nodes.length).toBeGreaterThan(1);
    expect(impact.epistemicState).toBe("INFERRED");
  });

  it("observe cycle persists graph.json", () => {
    const root = tempWorkspace();
    const result = runObserveCycle({
      workspaceRoot: root,
      projectSlug: "gdemo",
      persist: true,
    });
    expect(result.findings.some((f) => f.id === "graph-summary")).toBe(true);
    expect(result.atlasDir).toContain(".atlas");
  });

  it("builds identity → API → data security chain", () => {
    const root = tempWorkspace();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "src", "secure-route.ts"),
      `
import { requireAuth } from "./auth";
app.post("/api/payments", () => {
  const password = process.env.SECRET;
  return password;
});
`,
      "utf8",
    );
    writeFileSync(
      join(root, "docs", "ADR-010-payment-flow.md"),
      "# Payment must confirm before charge\n",
      "utf8",
    );

    const graph = buildSoftwareKnowledgeGraph({
      workspaceRoot: root,
      projectSlug: "gdemo",
    });
    expect(graph.nodes.some((n) => n.type === "IDENTITY")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "DATA_STORE")).toBe(true);
    expect(graph.edges.some((e) => e.type === "AUTHENTICATED_BY")).toBe(true);
    expect(graph.edges.some((e) => e.type === "EXPOSES_DATA")).toBe(true);
    const api = graph.nodes.find((n) => n.key.includes("/api/payments"));
    expect(api).toBeTruthy();
    const apiAuth = graph.edges.filter(
      (e) => e.type === "AUTHENTICATED_BY" && e.fromNodeId === api!.id,
    );
    expect(apiAuth.length).toBeGreaterThan(0);
    expect(graph.edges.some((e) => e.type === "DECIDED_BY")).toBe(true);
  });
});
