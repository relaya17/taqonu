/**
 * Personal Agent project knowledge — structured, scoped, provenance-bearing.
 *
 * This is not a repository dump. Facts are small OBSERVED / VERIFIED records
 * the Guardian can use without an LLM. Atlas remains the durable store;
 * this module only shapes retrieved memories + a bounded workspace scan.
 */

import type { EpistemicState } from "../constants/epistemic.js";

export const AGENT_KNOWLEDGE_KINDS = [
  "structure",
  "language",
  "framework",
  "code-symbol",
  "api-contract",
  "dependency",
  "architecture",
  "governance",
  "security",
  "error",
  "verified-fix",
  "failed-fix",
  "test-result",
  "preference",
] as const;

export type AgentKnowledgeKind = (typeof AGENT_KNOWLEDGE_KINDS)[number];

export interface AgentKnowledgeFact {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly kind: AgentKnowledgeKind;
  readonly what: string;
  readonly where: string | null;
  readonly why: string | null;
  readonly source: string;
  readonly epistemicState: EpistemicState | string;
  readonly observedAt: string;
  readonly verifiedAt: string | null;
  readonly scope: "project" | "workspace" | "application" | "user" | "policy";
  readonly keywords: readonly string[];
  readonly contradicts: readonly string[];
}

export interface RepoStructureInput {
  readonly apps: readonly string[];
  readonly packages: readonly string[];
  readonly sampleFiles: readonly string[];
  readonly topLevel?: readonly string[];
}

export interface FileSnippet {
  readonly path: string;
  readonly content: string;
}

export interface MemoryKnowledgeSource {
  readonly id: string;
  readonly type: string;
  readonly statement: string;
  readonly epistemicState: string;
  readonly category: string;
  readonly source: string;
  readonly projectId: string | null;
}

const MAX_MEMORY_FACTS = 40;
const MAX_SYMBOL_FACTS = 40;
const SNIPPET_SCAN_CHARS = 24_000;

const FUNCTION_RE =
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)/g;
const CLASS_RE = /(?:export\s+)?class\s+([A-Za-z_][\w]*)/g;
const TYPE_RE = /(?:export\s+)?(?:type|interface)\s+([A-Za-z_][\w]*)/g;
const ROUTE_RE =
  /\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]+)["'`]/gi;

function fact(input: Omit<AgentKnowledgeFact, "contradicts"> & {
  contradicts?: readonly string[];
}): AgentKnowledgeFact {
  return { ...input, contradicts: input.contradicts ?? [] };
}

const KEYWORD_STOP = new Set([
  "the",
  "and",
  "for",
  "this",
  "that",
  "from",
  "with",
  "into",
  "onto",
  "are",
  "was",
  "were",
  "has",
  "have",
  "been",
  "not",
  "but",
  "use",
  "uses",
  "used",
  "via",
  "per",
  "its",
  "under",
  "must",
  "keep",
  "does",
  "did",
  "than",
  "then",
  "them",
  "they",
  "their",
  "about",
  "exists",
  "using",
]);

function keywordsOf(...parts: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const token of part.toLowerCase().split(/[^a-z0-9./@_-]+/)) {
      if (token.length < 3 || KEYWORD_STOP.has(token)) continue;
      out.add(token);
    }
  }
  return Array.from(out).slice(0, 24);
}

export function discoverLanguages(sampleFiles: readonly string[]): string[] {
  const langs = new Set<string>();
  for (const file of sampleFiles) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) langs.add("TypeScript");
    if (lower.endsWith(".js") || lower.endsWith(".jsx")) langs.add("JavaScript");
    if (lower.endsWith(".py")) langs.add("Python");
    if (lower.endsWith(".go")) langs.add("Go");
    if (lower.endsWith(".rs")) langs.add("Rust");
  }
  return Array.from(langs);
}

export function discoverFrameworks(input: {
  sampleFiles: readonly string[];
  packageNames?: readonly string[];
}): string[] {
  const found = new Set<string>();
  for (const file of input.sampleFiles) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) found.add("React");
    if (lower.includes("next.config")) found.add("Next.js");
    if (lower.includes("vitest")) found.add("Vitest");
  }
  for (const name of input.packageNames ?? []) {
    const n = name.toLowerCase();
    if (n === "next" || n.startsWith("next/")) found.add("Next.js");
    if (n === "react" || n.startsWith("react-")) found.add("React");
    if (n === "vitest") found.add("Vitest");
    if (n.includes("express")) found.add("Express");
    if (n.includes("fastify")) found.add("Fastify");
    if (n.includes("supabase")) found.add("Supabase");
  }
  return Array.from(found);
}

function memoryKind(item: MemoryKnowledgeSource): AgentKnowledgeKind {
  const text = `${item.statement} ${item.source} ${item.type}`.toLowerCase();
  if (
    item.epistemicState === "CONTRADICTED" ||
    /\bfailed fix\b|\bfix failed\b|\bnot_fixed\b|\bskipped\b/.test(text)
  ) {
    return "failed-fix";
  }
  if (
    item.source === "bug-fix-learning" ||
    /\bverified fix\b/.test(text) ||
    ((item.epistemicState === "VERIFIED" || item.epistemicState === "CONFIRMED") &&
      item.type === "LESSON")
  ) {
    return "verified-fix";
  }
  if (item.category === "DECISION_MEMORY") return "architecture";
  if (/\berror\b|\bexception\b|\bfailure\b|\btypeerror\b|\bcrash\b/.test(text)) {
    return "error";
  }
  if (item.category === "EVENT_MEMORY") return "test-result";
  return "architecture";
}

function failedFixStaysFailed(item: MemoryKnowledgeSource): boolean {
  return memoryKind(item) === "failed-fix";
}

export function factsFromMemories(input: {
  projectId: string;
  ownerId: string;
  memories: readonly MemoryKnowledgeSource[];
  observedAt: string;
}): AgentKnowledgeFact[] {
  const facts: AgentKnowledgeFact[] = [];
  for (const item of input.memories) {
    if (facts.length >= MAX_MEMORY_FACTS) break;
    if (item.projectId && item.projectId !== input.projectId) continue;
    const kind = memoryKind(item);
    const verified =
      kind === "verified-fix" &&
      (item.epistemicState === "VERIFIED" || item.epistemicState === "CONFIRMED");
    facts.push(
      fact({
        id: `memory:${item.id}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind,
        what: item.statement.slice(0, 500),
        where: null,
        why: failedFixStaysFailed(item)
          ? "A failed fix must not be remembered as a successful solution."
          : kind === "verified-fix"
            ? "Previously verified fix in this project."
            : "Atlas memory retrieved for this owner and project.",
        source: item.source || "atlas-memory",
        epistemicState: item.epistemicState,
        observedAt: input.observedAt,
        verifiedAt: verified ? input.observedAt : null,
        scope: "project",
        keywords: keywordsOf(item.statement, item.type, item.category),
      }),
    );
  }
  return facts;
}

function factsFromSnippets(input: {
  projectId: string;
  ownerId: string;
  snippets: readonly FileSnippet[];
  observedAt: string;
}): AgentKnowledgeFact[] {
  const facts: AgentKnowledgeFact[] = [];
  for (const snippet of input.snippets) {
    const body = snippet.content.slice(0, SNIPPET_SCAN_CHARS);
    const pushSymbol = (
      kind: AgentKnowledgeKind,
      name: string,
      extra: string,
    ) => {
      if (facts.length >= MAX_SYMBOL_FACTS) return;
      facts.push(
        fact({
          id: `symbol:${snippet.path}:${kind}:${name}`,
          projectId: input.projectId,
          ownerId: input.ownerId,
          kind,
          what: extra,
          where: snippet.path,
          why: "Observed in a bounded file snippet — not a language service.",
          source: "workspace-snippet",
          epistemicState: "OBSERVED",
          observedAt: input.observedAt,
          verifiedAt: null,
          scope: "workspace",
          keywords: keywordsOf(name, snippet.path, extra),
        }),
      );
    };
    for (const match of body.matchAll(FUNCTION_RE)) {
      const name = match[1];
      if (name) pushSymbol("code-symbol", name, `Function ${name} exists.`);
    }
    for (const match of body.matchAll(CLASS_RE)) {
      const name = match[1];
      if (name) pushSymbol("code-symbol", name, `Class ${name} exists.`);
    }
    for (const match of body.matchAll(TYPE_RE)) {
      const name = match[1];
      if (name) pushSymbol("code-symbol", name, `Type ${name} exists.`);
    }
    for (const match of body.matchAll(ROUTE_RE)) {
      const method = match[1]?.toUpperCase();
      const route = match[2];
      if (!method || !route) continue;
      facts.push(
        fact({
          id: `route:${snippet.path}:${method}:${route}`,
          projectId: input.projectId,
          ownerId: input.ownerId,
          kind: "api-contract",
          what: `${method} ${route} is served from ${snippet.path}.`,
          where: snippet.path,
          why: "Observed HTTP route registration.",
          source: "workspace-snippet",
          epistemicState: "OBSERVED",
          observedAt: input.observedAt,
          verifiedAt: null,
          scope: "application",
          keywords: keywordsOf(method, route, snippet.path),
          contradicts: [
            `remove ${route}`,
            `delete ${route}`,
            `drop ${route}`,
            "accept raw workspaceroot from the client",
            "skip auth on this route",
          ],
        }),
      );
    }
  }
  return facts.slice(0, MAX_SYMBOL_FACTS);
}

export function discoverProjectKnowledge(input: {
  projectId: string;
  ownerId: string;
  analysis: RepoStructureInput;
  packageNames?: readonly string[];
  snippets?: readonly FileSnippet[];
  memories?: readonly MemoryKnowledgeSource[];
  observedAt?: string;
}): AgentKnowledgeFact[] {
  const observedAt = input.observedAt ?? "1970-01-01T00:00:00.000Z";
  const facts: AgentKnowledgeFact[] = [];

  for (const appName of input.analysis.apps) {
    facts.push(
      fact({
        id: `app:${input.projectId}:${appName}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "structure",
        what: `Application ${appName} exists under apps/.`,
        where: `apps/${appName}`,
        why: "Observed from workspace structure scan.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf(appName, `apps/${appName}`),
      }),
    );
  }
  for (const pkg of input.analysis.packages) {
    facts.push(
      fact({
        id: `pkg:${input.projectId}:${pkg}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "structure",
        what: `Package ${pkg} exists under packages/.`,
        where: `packages/${pkg}`,
        why: "Observed from workspace structure scan.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf(pkg, `packages/${pkg}`),
      }),
    );
  }

  const languages = discoverLanguages(input.analysis.sampleFiles);
  for (const language of languages) {
    facts.push(
      fact({
        id: `lang:${input.projectId}:${language}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "language",
        what: `This workspace uses ${language}.`,
        where: null,
        why: "Observed from file extensions in a bounded scan.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf(language),
      }),
    );
  }
  const frameworks = discoverFrameworks({
    sampleFiles: input.analysis.sampleFiles,
    ...(input.packageNames ? { packageNames: input.packageNames } : {}),
  });
  for (const framework of frameworks) {
    facts.push(
      fact({
        id: `fw:${input.projectId}:${framework}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "framework",
        what: `This workspace uses ${framework}.`,
        where: null,
        why: "Observed from filenames or package.json dependency names.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf(framework),
      }),
    );
  }

  for (const name of input.packageNames ?? []) {
    if (!name.startsWith("@") && !name.startsWith(".")) continue;
    facts.push(
      fact({
        id: `dep:${input.projectId}:${name}`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "dependency",
        what: `Package ${name} is a declared dependency.`,
        where: "package.json",
        why: "Observed from package.json keys — not a lockfile audit.",
        source: "package.json",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf(name),
        contradicts: [
          `delete ${name}`,
          `remove ${name}`,
          `inline ${name}`,
        ],
      }),
    );
  }

  const apps = new Set(input.analysis.apps.map((a) => a.toLowerCase()));
  if (apps.has("api") && (apps.has("web") || apps.has("admin"))) {
    facts.push(
      fact({
        id: `arch:${input.projectId}:api-boundary`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "architecture",
        what: "Privileged data access is reached through the API application, not from the user-plane client.",
        where: "apps/api",
        why: "Observed apps/api alongside a user-plane app in this workspace.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf("api", "database", "server-side", "boundary"),
        contradicts: [
          "database in the client",
          "database from the client",
          "postgres from the browser",
          "supabase from the client",
          "direct sql from the client",
          "move the database connection into the client",
        ],
      }),
    );
  }
  if (apps.has("web") && (apps.has("admin") || apps.has("control-plane"))) {
    facts.push(
      fact({
        id: `arch:${input.projectId}:control-boundary`,
        projectId: input.projectId,
        ownerId: input.ownerId,
        kind: "architecture",
        what: "Studio (apps/web) is the user workspace; admin/control-plane apps are a separate control plane.",
        where: "apps/web",
        why: "Observed both a web app and a control-plane app in this workspace.",
        source: "repository-structure",
        epistemicState: "OBSERVED",
        observedAt,
        verifiedAt: null,
        scope: "project",
        keywords: keywordsOf("studio", "control", "admin", "trust"),
        contradicts: [
          "merge control into studio",
          "merge control inbox",
          "control inbox into studio",
          "move control inbox into studio",
          "combine admin with studio",
        ],
      }),
    );
  }

  facts.push(
    ...factsFromSnippets({
      projectId: input.projectId,
      ownerId: input.ownerId,
      snippets: input.snippets ?? [],
      observedAt,
    }),
    ...factsFromMemories({
      projectId: input.projectId,
      ownerId: input.ownerId,
      memories: input.memories ?? [],
      observedAt,
    }),
  );

  return facts;
}

export function factsVisibleTo(
  facts: readonly AgentKnowledgeFact[],
  projectId: string,
  ownerId: string,
): AgentKnowledgeFact[] {
  return facts.filter(
    (factRow) =>
      factRow.scope === "policy" ||
      (factRow.projectId === projectId && factRow.ownerId === ownerId),
  );
}
