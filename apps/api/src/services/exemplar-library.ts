import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import {
  AtlasError,
  STUB_OWNER_ID,
  cloneExemplarBodySchema,
  exemplarRecordSchema,
  ingestExemplarBodySchema,
  isExemplarCloneReady,
  memorySchema,
  patchArtifactSchema,
  type ExemplarRecord,
  type ExemplarUnit,
  type IngestExemplarBody,
  type Memory,
  type PatchArtifact,
} from "@atlas/shared";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  resolveUnderWorkspace,
  type WorkspaceTreeNode,
} from "@atlas/code-intelligence";
import { osStore } from "../store/os-store.js";
import { findRepoRoot } from "./repo-root.js";

const CATALOG_SLUG = "exemplar-saas-mini";
const MAX_CLONE_FILES = 50;

export function catalogFixtureRoot(): string {
  return resolve(findRepoRoot(), "fixtures", "exemplar-saas-mini");
}

export function visibleExemplarsFor(ownerId: string): ExemplarRecord[] {
  return osStore.listExemplars().filter(
    (item) =>
      item.visibility === "catalog" ||
      item.ownerId === ownerId ||
      item.ownerId === STUB_OWNER_ID,
  );
}

export function canReadExemplar(
  record: ExemplarRecord,
  ownerId: string,
  role: string,
): boolean {
  if (role === "admin") return true;
  if (record.visibility === "catalog" || record.ownerId === STUB_OWNER_ID) {
    return true;
  }
  return record.ownerId === ownerId;
}

function flattenFiles(node: WorkspaceTreeNode, acc: string[]): void {
  if (node.kind === "file" && node.path) acc.push(node.path);
  for (const child of node.children ?? []) flattenFiles(child, acc);
}

function readManifest(sourceRoot: string): Record<string, unknown> | null {
  const manifestPath = join(sourceRoot, "atlas-exemplar.json");
  if (!existsSync(manifestPath)) return null;
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function synthesizeWholeUnit(sourceRoot: string): ExemplarUnit {
  const listed = listWorkspaceTree(sourceRoot, { maxEntries: 80, maxDepth: 8 });
  const paths: string[] = [];
  flattenFiles(listed.tree, paths);
  const sliced = paths.slice(0, 40);
  if (sliced.length === 0) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Exemplar sourceRoot has no cloneable text files",
      { statusCode: 400 },
    );
  }
  return {
    id: "whole",
    kind: "WHOLE",
    title: "Entire system",
    description: "All mapped files in this exemplar.",
    paths: sliced,
    dependsOn: [],
  };
}

export function ingestExemplarFromDisk(input: {
  readonly ownerId: string;
  readonly createdBy: string;
  readonly body: IngestExemplarBody;
}): ExemplarRecord {
  const sourceRoot = resolve(input.body.sourceRoot);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `sourceRoot not found: ${sourceRoot}`,
      { statusCode: 400 },
    );
  }
  // Prove the root is a real directory we can list (also rejects weird files).
  resolveUnderWorkspace(sourceRoot, "atlas-exemplar.json");

  const now = new Date().toISOString();
  const manifest = readManifest(sourceRoot);
  const unitsFromManifest = Array.isArray(manifest?.["units"])
    ? manifest["units"]
    : null;
  const completeness = (manifest?.["completeness"] as object | undefined) ?? {
    builds: false,
    runsLocally: false,
    hasAuth: false,
    hasConfigAndVersions: false,
    hasTests: false,
    hasDeployPath: false,
    hasEnvExample: existsSync(join(sourceRoot, ".env.example")),
    hasCloneMap: Boolean(manifest),
  };

  const record = exemplarRecordSchema.parse({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    visibility: input.body.visibility,
    slug: String(manifest?.["slug"] ?? input.body.slug),
    title: String(manifest?.["title"] ?? input.body.title),
    description: String(
      manifest?.["description"] ?? input.body.description ?? input.body.title,
    ),
    kind: manifest?.["kind"] ?? input.body.kind,
    version: String(manifest?.["version"] ?? input.body.version),
    sourceRoot,
    completeness,
    units:
      unitsFromManifest && unitsFromManifest.length > 0
        ? unitsFromManifest
        : [synthesizeWholeUnit(sourceRoot)],
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  });
  return osStore.upsertExemplar(record);
}

export function ensureCatalogSeeded(): ExemplarRecord | null {
  const existing = osStore.getExemplarBySlug(CATALOG_SLUG);
  if (existing) return existing;
  const root = catalogFixtureRoot();
  if (!existsSync(join(root, "atlas-exemplar.json"))) return null;
  return ingestExemplarFromDisk({
    ownerId: STUB_OWNER_ID,
    createdBy: "atlas-catalog",
    body: ingestExemplarBodySchema.parse({
      title: "Mini SaaS exemplar",
      slug: CATALOG_SLUG,
      kind: "saas",
      sourceRoot: root,
      visibility: "catalog",
    }),
  });
}

function unitById(
  exemplar: ExemplarRecord,
  unitId: string | undefined,
): ExemplarUnit[] {
  const wanted = (unitId ?? "WHOLE").trim();
  if (wanted === "" || wanted.toUpperCase() === "WHOLE") {
    const whole = exemplar.units.find((u) => u.kind === "WHOLE");
    return whole ? [whole] : exemplar.units;
  }
  const primary = exemplar.units.find((u) => u.id === wanted || u.kind === wanted);
  if (!primary) {
    throw new AtlasError("NOT_FOUND", `Unknown exemplar unit: ${wanted}`, {
      statusCode: 404,
    });
  }
  const deps = primary.dependsOn
    .map((id) => exemplar.units.find((u) => u.id === id || u.kind === id))
    .filter((u): u is ExemplarUnit => Boolean(u));
  return [...deps, primary];
}

function expandPaths(sourceRoot: string, declared: readonly string[]): string[] {
  const listed = listWorkspaceTree(sourceRoot, { maxEntries: 400, maxDepth: 10 });
  const all: string[] = [];
  flattenFiles(listed.tree, all);
  const out = new Set<string>();
  for (const rel of declared) {
    const posixRel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    if (all.includes(posixRel)) {
      out.add(posixRel);
      continue;
    }
    const prefix = posixRel.endsWith("/") ? posixRel : `${posixRel}/`;
    for (const file of all) {
      if (file === posixRel || file.startsWith(prefix)) out.add(file);
    }
    if (!out.has(posixRel) && existsSync(join(sourceRoot, posixRel))) {
      const st = statSync(join(sourceRoot, posixRel));
      if (st.isFile()) out.add(posixRel);
    }
  }
  return [...out];
}

function destPath(targetPrefix: string | undefined, rel: string): string {
  const prefix = (targetPrefix ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (prefix.split("/").includes("..")) {
    throw new AtlasError("VALIDATION_ERROR", "targetPrefix escapes workspace", {
      statusCode: 400,
    });
  }
  return prefix ? posix.join(prefix, rel) : rel;
}

export function buildClonePatch(input: {
  readonly exemplar: ExemplarRecord;
  readonly unitId?: string;
  readonly workspaceRoot: string;
  readonly projectId: string;
  readonly targetPrefix?: string;
  readonly createdBy: string;
  readonly ownerId: string;
}): { patch: PatchArtifact; memory: Memory; cloneReady: boolean } {
  const units = unitById(input.exemplar, input.unitId);
  const declared = units.flatMap((u) => u.paths);
  const files = expandPaths(input.exemplar.sourceRoot, declared);
  if (files.length === 0) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Clone unit matched no files under sourceRoot",
      { statusCode: 400 },
    );
  }
  if (files.length > MAX_CLONE_FILES) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `Clone would write ${files.length} files (max ${MAX_CLONE_FILES})`,
      { statusCode: 400 },
    );
  }

  const filesChanged = files.map((rel) => {
    const view = readWorkspaceFile(input.exemplar.sourceRoot, rel);
    const path = destPath(input.targetPrefix, rel);
    let previous: string | undefined;
    try {
      previous = readWorkspaceFile(input.workspaceRoot, path).content;
    } catch {
      previous = undefined;
    }
    return {
      path,
      action: (previous === undefined ? "add" : "modify") as "add" | "modify",
      summary: `Clone ${input.exemplar.slug} · ${rel}`,
      afterContent: view.content,
      unifiedDiff: previous
        ? undefined
        : `--- /dev/null\n+++ b/${path}\n${view.content
            .split("\n")
            .map((l) => `+${l}`)
            .join("\n")}`,
    };
  });

  const now = new Date().toISOString();
  const unitLabel = input.unitId?.trim() || "WHOLE";
  const isWhole = !input.unitId || unitLabel.toUpperCase() === "WHOLE";
  const patch = patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: `Clone exemplar ${input.exemplar.slug} · ${unitLabel}`,
    reason: `Personal agent clone from ${input.exemplar.title} (${input.exemplar.version}). Apply after Approve. Track deploy after apply.`,
    mode: "implement",
    status: "AWAITING_APPROVAL",
    risk: isWhole ? "HIGH" : "MEDIUM",
    baseCommit: null,
    targetBranch: null,
    filesChanged,
    evidenceIds: [],
    claimIds: [],
    expectedImpact: `Copy ${filesChanged.length} file(s) from exemplar ${input.exemplar.slug}.`,
    tests: files.filter((f) => /\.test\./.test(f)).slice(0, 8),
    evaluationSummary: [
      `cloneReady=${isExemplarCloneReady(input.exemplar.completeness)}`,
      `sourceRoot=${input.exemplar.sourceRoot}`,
      `units=${units.map((u) => u.id).join(",")}`,
    ].join("\n"),
    approvals: [],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    epistemicState: "PROPOSED",
    confidence: isExemplarCloneReady(input.exemplar.completeness) ? 0.8 : 0.45,
    authorityHint: "DEVELOPER_STATEMENT",
  });
  osStore.upsertPatch(patch);

  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    type: "ARCHITECTURE",
    projectId: input.projectId,
    statement: `Tracking clone of ${input.exemplar.slug} unit ${unitLabel} into this project. After Approve→Apply, follow build and deploy. Completeness cloneReady=${isExemplarCloneReady(input.exemplar.completeness)}.`,
    reason: ["studio-clone", `exemplar:${input.exemplar.id}`, `patch:${patch.id}`],
    status: "ACTIVE",
    confidence: 0.8,
    category: "DECISION_MEMORY",
    epistemicState: "CONFIRMED",
    observationMode: "CONFIRMED",
    source: "studio-clone",
    sourceType: "SYSTEM",
    sourceId: patch.id,
    evidence: [
      {
        id: crypto.randomUUID(),
        kind: "exemplar",
        reference: input.exemplar.id,
        excerpt: input.exemplar.title.slice(0, 400),
      },
    ],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    scope: "PROJECT",
    priority: "HIGH",
    agentId: "CODE_ENGINEER",
  });
  osStore.addMemory(memory);
  osStore.appendAudit({
    type: "exemplar.cloned",
    exemplarId: input.exemplar.id,
    patchId: patch.id,
    unitId: unitLabel,
    projectId: input.projectId,
    at: now,
  });

  return {
    patch,
    memory,
    cloneReady: isExemplarCloneReady(input.exemplar.completeness),
  };
}

export function parseIngestBody(body: unknown): IngestExemplarBody {
  return ingestExemplarBodySchema.parse(body);
}

export function parseCloneBody(body: unknown) {
  return cloneExemplarBodySchema.parse(body);
}
