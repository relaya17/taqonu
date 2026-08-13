/**
 * Merge Sentinel dependency advisories into Software Knowledge Graph.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  graphEdgeSchema,
  graphNodeSchema,
  type GraphEdge,
  type GraphNode,
} from "@atlas/shared";
import { createHash } from "node:crypto";
import type { SoftwareKnowledgeGraph } from "../graph/build.js";
import type { DependencyFinding } from "./deps.js";
import type { SentinelScanResult } from "./scan.js";

const OWNER_FALLBACK = "00000000-0000-4000-8000-000000000001";

function stableUuid(key: string): string {
  const h = createHash("sha256").update(`atlas-graph:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function putNode(nodes: GraphNode[], node: GraphNode): GraphNode {
  const existing = nodes.find((n) => n.id === node.id);
  if (existing) return existing;
  nodes.push(node);
  return node;
}

function putEdge(edges: GraphEdge[], edge: GraphEdge): void {
  if (edges.some((e) => e.id === edge.id)) return;
  edges.push(edge);
}

function readDirectDeps(root: string): Record<string, string> {
  const file = join(root, "package.json");
  if (!existsSync(file)) return {};
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

function makePackageNode(
  projectId: string | null,
  name: string,
  version: string,
  props: Record<string, unknown>,
): GraphNode {
  const now = nowIso();
  return graphNodeSchema.parse({
    id: stableUuid(`${projectId ?? "na"}:PACKAGE:${name}`),
    ownerId: OWNER_FALLBACK,
    projectId,
    type: "PACKAGE",
    key: name,
    label: `${name}@${version}`,
    epistemicState: "OBSERVED",
    confidence: 0.85,
    evidenceIds: [],
    properties: { version, ...props },
    createdAt: now,
    updatedAt: now,
  });
}

function makeIncidentNode(
  projectId: string | null,
  finding: DependencyFinding,
): GraphNode {
  const now = nowIso();
  return graphNodeSchema.parse({
    id: stableUuid(
      `${projectId ?? "na"}:INCIDENT:advisory:${finding.advisoryId}`,
    ),
    ownerId: OWNER_FALLBACK,
    projectId,
    type: "INCIDENT",
    key: finding.advisoryId,
    label: finding.title,
    epistemicState: "OBSERVED",
    confidence: 0.8,
    evidenceIds: [],
    properties: {
      kind: "dependency_advisory",
      severity: finding.severity,
      sourceUrl: finding.sourceUrl,
      packageName: finding.packageName,
      installed: finding.installed,
    },
    createdAt: now,
    updatedAt: now,
  });
}

/** Mutates graph in place: PACKAGE nodes + advisory INCIDENT edges. */
export function mergeSentinelIntoGraph(
  graph: SoftwareKnowledgeGraph,
  scan: SentinelScanResult,
): SoftwareKnowledgeGraph {
  const projectId = graph.projectId;
  const project = graph.nodes.find((n) => n.type === "PROJECT");
  const deps = readDirectDeps(graph.workspaceRoot);
  const advisoryPkgs = new Set(scan.dependencies.map((d) => d.packageName));

  // Prefer advisory packages; also seed a few direct deps for DEPENDS_ON surface
  const names = [
    ...advisoryPkgs,
    ...Object.keys(deps)
      .filter((n) => !advisoryPkgs.has(n))
      .slice(0, 20),
  ];

  for (const name of names) {
    const version =
      scan.dependencies.find((d) => d.packageName === name)?.installed ??
      deps[name] ??
      "unknown";
    const pkg = putNode(
      graph.nodes,
      makePackageNode(projectId, name, version, {
        vulnerable: advisoryPkgs.has(name),
      }),
    );
    if (project) {
      putEdge(
        graph.edges,
        graphEdgeSchema.parse({
          id: stableUuid(
            `${projectId ?? "na"}:DEPENDS_ON:${project.id}:${pkg.id}`,
          ),
          ownerId: OWNER_FALLBACK,
          projectId,
          type: "DEPENDS_ON",
          fromNodeId: project.id,
          toNodeId: pkg.id,
          epistemicState: "OBSERVED",
          confidence: 0.9,
          evidenceIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }),
      );
    }
  }

  for (const finding of scan.dependencies) {
    const pkg = graph.nodes.find(
      (n) => n.type === "PACKAGE" && n.key === finding.packageName,
    );
    if (!pkg) continue;
    const incident = putNode(graph.nodes, makeIncidentNode(projectId, finding));
    putEdge(
      graph.edges,
      graphEdgeSchema.parse({
        id: stableUuid(
          `${projectId ?? "na"}:CAUSED:${incident.id}:${pkg.id}`,
        ),
        ownerId: OWNER_FALLBACK,
        projectId,
        type: "CAUSED",
        fromNodeId: incident.id,
        toNodeId: pkg.id,
        epistemicState: "OBSERVED",
        confidence: 0.85,
        evidenceIds: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }),
    );
  }

  return graph;
}
