import { describe, expect, it } from "vitest";
import { evaluateSecurityGraphPolicy } from "./graph-policy.js";
import type { SoftwareKnowledgeGraph } from "../graph/build.js";
import { stableUuid } from "../graph/build.js";

function emptyGraph(): SoftwareKnowledgeGraph {
  return {
    version: 1,
    projectId: null,
    workspaceRoot: "/tmp",
    builtAt: new Date().toISOString(),
    nodes: [],
    edges: [],
  };
}

describe("evaluateSecurityGraphPolicy", () => {
  it("flags EXPOSES_DATA APIs without AUTHENTICATED_BY", () => {
    const graph = emptyGraph();
    const apiId = stableUuid("na:API:/pay");
    const storeId = stableUuid("na:DATA_STORE:x");
    const now = new Date().toISOString();
    graph.nodes.push(
      {
        id: apiId,
        ownerId: "00000000-0000-4000-8000-000000000001",
        projectId: null,
        type: "API",
        key: "POST /pay",
        label: "POST /pay",
        epistemicState: "OBSERVED",
        confidence: 0.8,
        evidenceIds: [],
        properties: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: storeId,
        ownerId: "00000000-0000-4000-8000-000000000001",
        projectId: null,
        type: "DATA_STORE",
        key: "data:x",
        label: "data",
        epistemicState: "ASSUMED",
        confidence: 0.5,
        evidenceIds: [],
        properties: {},
        createdAt: now,
        updatedAt: now,
      },
    );
    graph.edges.push({
      id: stableUuid("edge"),
      ownerId: "00000000-0000-4000-8000-000000000001",
      projectId: null,
      type: "EXPOSES_DATA",
      fromNodeId: apiId,
      toNodeId: storeId,
      epistemicState: "INFERRED",
      confidence: 0.6,
      evidenceIds: [],
      createdAt: now,
      updatedAt: now,
    });

    const findings = evaluateSecurityGraphPolicy(graph);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("HIGH");
  });
});
