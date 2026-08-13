import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  graphEdgeSchema,
  graphNodeSchema,
  type GraphEdge,
  type GraphEdgeType,
  type GraphNode,
  type GraphNodeType,
} from "@atlas/shared";
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";
import { atlasObserverPaths } from "../paths.js";

const OWNER_FALLBACK = "00000000-0000-4000-8000-000000000001";

/** Deterministic UUIDv4-shaped id from stable key (no extra deps). */
export function stableUuid(key: string): string {
  const h = createHash("sha256").update(`atlas-graph:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeNode(input: {
  projectId: string | null;
  type: GraphNodeType;
  key: string;
  label: string;
  epistemicState?: GraphNode["epistemicState"];
  confidence?: number;
  properties?: GraphNode["properties"];
}): GraphNode {
  const now = nowIso();
  return graphNodeSchema.parse({
    id: stableUuid(`${input.projectId ?? "na"}:${input.type}:${input.key}`),
    ownerId: OWNER_FALLBACK,
    projectId: input.projectId,
    type: input.type,
    key: input.key,
    label: input.label,
    epistemicState: input.epistemicState ?? "OBSERVED",
    confidence: input.confidence ?? 0.75,
    evidenceIds: [],
    properties: input.properties ?? {},
    createdAt: now,
    updatedAt: now,
  });
}

function makeEdge(input: {
  projectId: string | null;
  type: GraphEdgeType;
  from: GraphNode;
  to: GraphNode;
  epistemicState?: GraphEdge["epistemicState"];
  confidence?: number;
}): GraphEdge {
  const now = nowIso();
  return graphEdgeSchema.parse({
    id: stableUuid(
      `${input.projectId ?? "na"}:${input.type}:${input.from.id}:${input.to.id}`,
    ),
    ownerId: OWNER_FALLBACK,
    projectId: input.projectId,
    type: input.type,
    fromNodeId: input.from.id,
    toNodeId: input.to.id,
    epistemicState: input.epistemicState ?? "INFERRED",
    confidence: input.confidence ?? 0.65,
    evidenceIds: [],
    createdAt: now,
    updatedAt: now,
  });
}

const IMPORT_RE =
  /(?:import\s+[\s\S]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
const EXPORT_FN_RE =
  /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
const ROUTE_RE =
  /(?:app|router|fastify)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
const ATLAS_FLOW_RE =
  /@atlas-flow\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/gi;

export interface SoftwareKnowledgeGraph {
  version: 1;
  projectId: string | null;
  workspaceRoot: string;
  builtAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function resolveImportPath(
  fromFile: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  if (!spec.startsWith(".")) return null;
  const base = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const joined = join(base, spec).replace(/\\/g, "/");
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}/index.ts`,
  ];
  for (const c of candidates) {
    const norm = c.replace(/^\.\//, "");
    if (fileSet.has(norm)) return norm;
  }
  return null;
}

/** Build Software Knowledge Graph v0 from a workspace (heuristic, evidence-labeled). */
export function buildSoftwareKnowledgeGraph(input: {
  workspaceRoot: string;
  projectId?: string | null;
  projectSlug?: string | null;
}): SoftwareKnowledgeGraph {
  const projectId = input.projectId ?? null;
  const analysis = analyzeRepository(input.workspaceRoot);
  const files = analysis.sampleFiles.slice(0, 120);
  const fileSet = new Set(files);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byKey = new Map<string, GraphNode>();

  const put = (n: GraphNode) => {
    const k = `${n.type}:${n.key}`;
    const existing = byKey.get(k);
    if (existing) return existing;
    byKey.set(k, n);
    nodes.push(n);
    return n;
  };

  const project = put(
    makeNode({
      projectId,
      type: "PROJECT",
      key: input.projectSlug ?? "project",
      label: input.projectSlug ?? "Project",
      epistemicState: "OBSERVED",
      confidence: 0.9,
      properties: { fileCount: analysis.fileCount },
    }),
  );

  const fileNodes = new Map<string, GraphNode>();
  for (const rel of files) {
    const node = put(
      makeNode({
        projectId,
        type: "FILE",
        key: rel,
        label: rel.split("/").pop() ?? rel,
        properties: { path: rel },
      }),
    );
    fileNodes.set(rel, node);
    edges.push(
      makeEdge({
        projectId,
        type: "CONTAINS",
        from: project,
        to: node,
        epistemicState: "OBSERVED",
        confidence: 0.95,
      }),
    );
  }

  for (const rel of files) {
    const text = readTextFile(input.workspaceRoot, rel);
    if (!text) continue;
    const fromFile = fileNodes.get(rel);
    if (!fromFile) continue;

    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text))) {
      const spec = m[1];
      if (!spec) continue;
      const target = resolveImportPath(rel, spec, fileSet);
      if (!target) continue;
      const toFile = fileNodes.get(target);
      if (!toFile) continue;
      edges.push(
        makeEdge({
          projectId,
          type: "DEPENDS_ON",
          from: fromFile,
          to: toFile,
        }),
      );
    }

    EXPORT_FN_RE.lastIndex = 0;
    while ((m = EXPORT_FN_RE.exec(text))) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      const fn = put(
        makeNode({
          projectId,
          type: "FUNCTION",
          key: `${rel}#${name}`,
          label: name,
          properties: { file: rel },
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "CONTAINS",
          from: fromFile,
          to: fn,
          epistemicState: "OBSERVED",
          confidence: 0.8,
        }),
      );
    }

    ROUTE_RE.lastIndex = 0;
    while ((m = ROUTE_RE.exec(text))) {
      const method = (m[1] ?? "get").toUpperCase();
      const path = m[2] ?? "/";
      const api = put(
        makeNode({
          projectId,
          type: "API",
          key: `${method} ${path}`,
          label: `${method} ${path}`,
          properties: { file: rel, method, path },
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "IMPLEMENTS",
          from: fromFile,
          to: api,
          epistemicState: "OBSERVED",
          confidence: 0.7,
        }),
      );
    }

    ATLAS_FLOW_RE.lastIndex = 0;
    while ((m = ATLAS_FLOW_RE.exec(text))) {
      const method = (m[1] ?? "POST").toUpperCase();
      const path = m[2] ?? "/";
      const key = `${method} ${path}`;
      if (byKey.has(`API:${key}`)) continue;
      const api = put(
        makeNode({
          projectId,
          type: "API",
          key,
          label: key,
          properties: { file: rel, annotated: true },
          epistemicState: "OBSERVED",
          confidence: 0.9,
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "IMPLEMENTS",
          from: fromFile,
          to: api,
          epistemicState: "OBSERVED",
          confidence: 0.9,
        }),
      );
    }

    if (/\.(test|spec)\./i.test(rel) || /__tests__/.test(rel)) {
      const testNode = put(
        makeNode({
          projectId,
          type: "TEST",
          key: rel,
          label: rel.split("/").pop() ?? rel,
          properties: { path: rel },
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "CONTAINS",
          from: fromFile,
          to: testNode,
          epistemicState: "OBSERVED",
          confidence: 0.85,
        }),
      );
      // Link tests to sibling source when obvious
      const sibling = rel
        .replace(/\.(test|spec)\./i, ".")
        .replace(/__tests__\//, "");
      const target = fileNodes.get(sibling);
      if (target) {
        edges.push(
          makeEdge({
            projectId,
            type: "TESTED_BY",
            from: target,
            to: testNode,
            epistemicState: "INFERRED",
            confidence: 0.6,
          }),
        );
      }
    }

    if (/(^|\/)\.env|config\.(ts|js|json)$/i.test(rel)) {
      put(
        makeNode({
          projectId,
          type: "CONFIG",
          key: rel,
          label: rel,
          properties: { path: rel },
        }),
      );
    }

    // Security graph: identity → API → data (TRUTH-10 · 1.2)
    const hasAuthBoundary =
      /\b(requireAuth|requireUser|requireSignedIn|authenticate|verifyJwt|authGuard)\b/.test(
        text,
      );
    const hasSensitive =
      /\b(password|secret|api[_-]?key|creditCard|ssn|nationalId|ENCRYPTION_KEY)\b/i.test(
        text,
      );

    if (hasAuthBoundary) {
      const identity = put(
        makeNode({
          projectId,
          type: "IDENTITY",
          key: "identity:principal",
          label: "authenticated principal",
          properties: { kind: "principal" },
          epistemicState: "INFERRED",
          confidence: 0.7,
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "AUTHENTICATED_BY",
          from: fromFile,
          to: identity,
          epistemicState: "INFERRED",
          confidence: 0.6,
        }),
      );
      for (const node of nodes) {
        if (node.type !== "API") continue;
        if (node.properties?.file !== rel) continue;
        edges.push(
          makeEdge({
            projectId,
            type: "AUTHENTICATED_BY",
            from: node,
            to: identity,
            epistemicState: "INFERRED",
            confidence: 0.65,
          }),
        );
      }
    }

    if (hasSensitive) {
      const storeKey = `data:${rel}`;
      const dataStore = put(
        makeNode({
          projectId,
          type: "DATA_STORE",
          key: storeKey,
          label: `data@${rel.split("/").pop()}`,
          properties: { kind: "sensitive_touchpoint", file: rel },
          epistemicState: "ASSUMED",
          confidence: 0.55,
        }),
      );
      edges.push(
        makeEdge({
          projectId,
          type: "EXPOSES_DATA",
          from: fromFile,
          to: dataStore,
          epistemicState: "INFERRED",
          confidence: 0.55,
        }),
      );
      for (const node of nodes) {
        if (node.type !== "API") continue;
        if (node.properties?.file !== rel) continue;
        edges.push(
          makeEdge({
            projectId,
            type: "EXPOSES_DATA",
            from: node,
            to: dataStore,
            epistemicState: "INFERRED",
            confidence: 0.6,
          }),
        );
      }
    }
  }

  // Engineering memory seed: ADR / decision docs → DECISION nodes
  for (const rel of files) {
    if (!/(^|\/)ADR[-_].+\.md$/i.test(rel) && !/\/decisions\//i.test(rel)) {
      continue;
    }
    const decision = put(
      makeNode({
        projectId,
        type: "DECISION",
        key: rel,
        label: rel.split("/").pop() ?? rel,
        properties: { path: rel },
        epistemicState: "OBSERVED",
        confidence: 0.85,
      }),
    );
    edges.push(
      makeEdge({
        projectId,
        type: "CONTAINS",
        from: project,
        to: decision,
        epistemicState: "OBSERVED",
        confidence: 0.9,
      }),
    );
    // Link payment/booking APIs to payment-related ADRs when filenames suggest it
    const topic = rel.toLowerCase();
    for (const node of nodes) {
      if (node.type !== "API") continue;
      const apiKey = node.key.toLowerCase();
      const paymentish =
        /payment|billing|charge|checkout/.test(topic) &&
        /payment|billing|charge|checkout|booking/.test(apiKey);
      const authish =
        /auth|tenant|identity/.test(topic) &&
        /auth|login|session|tenant/.test(apiKey);
      if (!paymentish && !authish) continue;
      edges.push(
        makeEdge({
          projectId,
          type: "DECIDED_BY",
          from: node,
          to: decision,
          epistemicState: "INFERRED",
          confidence: 0.5,
        }),
      );
    }
  }

  // Deduplicate edges by id
  const edgeById = new Map<string, GraphEdge>();
  for (const e of edges) edgeById.set(e.id, e);

  return {
    version: 1,
    projectId,
    workspaceRoot: input.workspaceRoot,
    builtAt: nowIso(),
    nodes: [...byKey.values()],
    edges: [...edgeById.values()],
  };
}

export function graphPath(workspaceRoot: string): string {
  return join(atlasObserverPaths(workspaceRoot).genome, "graph.json");
}

export function saveSoftwareKnowledgeGraph(
  graph: SoftwareKnowledgeGraph,
): string {
  const file = graphPath(graph.workspaceRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(graph, null, 2), "utf8");
  return file;
}

export function loadSoftwareKnowledgeGraph(
  workspaceRoot: string,
): SoftwareKnowledgeGraph | null {
  const file = graphPath(workspaceRoot);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as SoftwareKnowledgeGraph;
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** BFS impact from a node across DEPENDS_ON / CALLS / IMPLEMENTS / TESTED_BY / CONTAINS. */
export function computeGraphImpact(input: {
  graph: SoftwareKnowledgeGraph;
  rootNodeId: string;
  depth?: number;
  direction?: "OUT" | "IN" | "BOTH";
}): {
  rootNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  epistemicState: "FACT" | "INFERRED" | "UNKNOWN" | "CONFLICTED";
} {
  const depth = input.depth ?? 3;
  const direction = input.direction ?? "BOTH";
  const byId = new Map(input.graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(input.rootNodeId)) {
    return {
      rootNodeId: input.rootNodeId,
      nodes: [],
      edges: [],
      epistemicState: "UNKNOWN",
    };
  }

  const outAdj = new Map<string, GraphEdge[]>();
  const inAdj = new Map<string, GraphEdge[]>();
  for (const e of input.graph.edges) {
    const o = outAdj.get(e.fromNodeId) ?? [];
    o.push(e);
    outAdj.set(e.fromNodeId, o);
    const i = inAdj.get(e.toNodeId) ?? [];
    i.push(e);
    inAdj.set(e.toNodeId, i);
  }

  const seen = new Set<string>([input.rootNodeId]);
  const keptEdges: GraphEdge[] = [];
  let frontier = [input.rootNodeId];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (direction === "OUT" || direction === "BOTH") {
        for (const e of outAdj.get(id) ?? []) {
          keptEdges.push(e);
          if (!seen.has(e.toNodeId)) {
            seen.add(e.toNodeId);
            next.push(e.toNodeId);
          }
        }
      }
      if (direction === "IN" || direction === "BOTH") {
        for (const e of inAdj.get(id) ?? []) {
          keptEdges.push(e);
          if (!seen.has(e.fromNodeId)) {
            seen.add(e.fromNodeId);
            next.push(e.fromNodeId);
          }
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  const edgeById = new Map(keptEdges.map((e) => [e.id, e]));
  return {
    rootNodeId: input.rootNodeId,
    nodes: [...seen].map((id) => byId.get(id)!).filter(Boolean),
    edges: [...edgeById.values()],
    epistemicState: "INFERRED",
  };
}
