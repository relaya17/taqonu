import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { GraphEdge, GraphNode } from "@atlas/shared";
import {
  graphEdgeSchema,
  graphNodeSchema,
} from "@atlas/shared";
import { atlasObserverPaths } from "../paths.js";
import type { SoftwareKnowledgeGraph } from "../graph/build.js";
import { stableUuid } from "../graph/build.js";

export interface DeployEvent {
  id: string;
  provider: string;
  environment: "production" | "preview" | "development" | string;
  status: string;
  observedAt: string;
  url: string | null;
  commitSha: string | null;
  hostLabel: string;
  summary: string;
}

const OWNER_FALLBACK = "00000000-0000-4000-8000-000000000001";

export function deployEventsPath(workspaceRoot: string): string {
  return atlasObserverPaths(workspaceRoot).productionDeploys;
}

export function loadDeployEvents(workspaceRoot: string): DeployEvent[] {
  const file = deployEventsPath(workspaceRoot);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is DeployEvent => Boolean(e && typeof e === "object"))
      .slice(0, 40);
  } catch {
    return [];
  }
}

export function recordDeployEvent(
  workspaceRoot: string,
  event: Omit<DeployEvent, "id"> & { id?: string },
): DeployEvent {
  const file = deployEventsPath(workspaceRoot);
  mkdirSync(dirname(file), { recursive: true });
  const full: DeployEvent = {
    id: event.id ?? crypto.randomUUID(),
    provider: event.provider,
    environment: event.environment,
    status: event.status,
    observedAt: event.observedAt,
    url: event.url,
    commitSha: event.commitSha,
    hostLabel: event.hostLabel,
    summary: event.summary,
  };
  const next = [full, ...loadDeployEvents(workspaceRoot).filter((e) => e.id !== full.id)].slice(
    0,
    40,
  );
  writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return full;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Attach recent deploy events as DEPLOYMENT nodes + DEPLOYED_AS edges. */
export function mergeDeployEventsIntoGraph(
  graph: SoftwareKnowledgeGraph,
): SoftwareKnowledgeGraph {
  const events = loadDeployEvents(graph.workspaceRoot).slice(0, 8);
  if (!events.length) return graph;

  const project =
    graph.nodes.find((n) => n.type === "PROJECT") ?? graph.nodes[0];
  if (!project) return graph;

  const nodes: GraphNode[] = [...graph.nodes];
  const edges: GraphEdge[] = [...graph.edges];
  const seen = new Set(nodes.map((n) => `${n.type}:${n.key}`));

  for (const ev of events) {
    const key = `${ev.provider}:${ev.observedAt}:${ev.commitSha ?? ev.id}`;
    if (seen.has(`DEPLOYMENT:${key}`)) continue;
    seen.add(`DEPLOYMENT:${key}`);
    const now = nowIso();
    const node = graphNodeSchema.parse({
      id: stableUuid(`${graph.projectId ?? "na"}:DEPLOYMENT:${key}`),
      ownerId: OWNER_FALLBACK,
      projectId: graph.projectId,
      type: "DEPLOYMENT",
      key,
      label: `${ev.provider} ${ev.environment} · ${ev.status}`,
      epistemicState: "OBSERVED",
      confidence: 0.85,
      evidenceIds: [],
      properties: {
        provider: ev.provider,
        environment: ev.environment,
        status: ev.status,
        url: ev.url,
        commitSha: ev.commitSha,
        hostLabel: ev.hostLabel,
        observedAt: ev.observedAt,
      },
      createdAt: now,
      updatedAt: now,
    });
    nodes.push(node);
    edges.push(
      graphEdgeSchema.parse({
        id: stableUuid(
          `${graph.projectId ?? "na"}:DEPLOYED_AS:${project.id}:${node.id}`,
        ),
        ownerId: OWNER_FALLBACK,
        projectId: graph.projectId,
        type: "DEPLOYED_AS",
        fromNodeId: project.id,
        toNodeId: node.id,
        epistemicState: "OBSERVED",
        confidence: 0.8,
        evidenceIds: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  return { ...graph, nodes, edges };
}

export function summarizeLastDeploy(events: readonly DeployEvent[]): {
  present: boolean;
  last: DeployEvent | null;
  productionCount: number;
  failedCount: number;
} {
  const last = events[0] ?? null;
  const failedCount = events.filter((e) =>
    /error|fail|suspend/i.test(e.status),
  ).length;
  const productionCount = events.filter(
    (e) => e.environment === "production",
  ).length;
  return {
    present: Boolean(last),
    last,
    productionCount,
    failedCount,
  };
}
