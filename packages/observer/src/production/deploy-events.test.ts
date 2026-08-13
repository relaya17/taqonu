import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildSoftwareKnowledgeGraph } from "../graph/build.js";
import {
  loadDeployEvents,
  mergeDeployEventsIntoGraph,
  recordDeployEvent,
  summarizeLastDeploy,
} from "./deploy-events.js";

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

describe("deploy events", () => {
  it("records and merges DEPLOYMENT nodes into the graph", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-deploy-"));
    temps.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "d" }),
      "utf8",
    );
    writeFileSync(join(root, "src", "a.ts"), "export const x = 1;\n", "utf8");

    recordDeployEvent(root, {
      provider: "vercel",
      environment: "production",
      status: "READY",
      observedAt: new Date().toISOString(),
      url: "https://example.vercel.app",
      commitSha: "abc123",
      hostLabel: "app",
      summary: "prod ready",
    });

    expect(loadDeployEvents(root)).toHaveLength(1);
    const base = buildSoftwareKnowledgeGraph({
      workspaceRoot: root,
      projectSlug: "d",
    });
    const merged = mergeDeployEventsIntoGraph(base);
    expect(merged.nodes.some((n) => n.type === "DEPLOYMENT")).toBe(true);
    expect(merged.edges.some((e) => e.type === "DEPLOYED_AS")).toBe(true);
    const summary = summarizeLastDeploy(loadDeployEvents(root));
    expect(summary.productionCount).toBe(1);
    expect(summary.last?.status).toBe("READY");
  });
});
