import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  observerBugSchema,
  type BugSeverity,
  type BugStatus,
  type ObserverBug,
  type ObserverClaimKind,
} from "@atlas/shared";
import { atlasObserverPaths } from "../paths.js";

export interface BugIngestInput {
  title: string;
  detail?: string | undefined;
  severity?: BugSeverity | undefined;
  status?: BugStatus | undefined;
  source?: string | undefined;
  linkedFlowId?: string | null | undefined;
  projectId?: string | null | undefined;
}

const CRITICAL = /\b(data loss|rce|auth bypass|payment|charge|security)\b/i;
const HIGH = /\b(crash|500|outage|corrupt|leak|p0|p1)\b/i;
const LOW = /\b(typo|copy|ui polish|cosmetic)\b/i;

export function classifyBugSeverity(
  title: string,
  detail = "",
): BugSeverity {
  const text = `${title}\n${detail}`;
  if (CRITICAL.test(text)) return "CRITICAL";
  if (HIGH.test(text)) return "HIGH";
  if (LOW.test(text)) return "LOW";
  return "MEDIUM";
}

export function claimForBugStatus(status: BugStatus): ObserverClaimKind {
  switch (status) {
    case "VERIFIED":
      return "VERIFIED";
    case "REPRODUCED":
      return "OBSERVED";
    case "FIXED":
      return "INFERRED";
    case "WONTFIX":
      return "UNKNOWN";
    default:
      return "SUSPECTED";
  }
}

export function createBug(input: BugIngestInput): ObserverBug {
  const now = new Date().toISOString();
  const status = input.status ?? "OPEN";
  const severity =
    input.severity ?? classifyBugSeverity(input.title, input.detail ?? "");
  return observerBugSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    title: input.title,
    detail: input.detail ?? "",
    status,
    severity,
    claim: claimForBugStatus(status),
    source: input.source ?? "manual",
    linkedFlowId: input.linkedFlowId ?? null,
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function loadBugs(workspaceRoot: string): ObserverBug[] {
  const { bugsOpen } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(bugsOpen)) return [];
  try {
    const raw = JSON.parse(readFileSync(bugsOpen, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        try {
          return observerBugSchema.parse(item);
        } catch {
          return null;
        }
      })
      .filter((b): b is ObserverBug => b !== null);
  } catch {
    return [];
  }
}

export function saveBugs(
  workspaceRoot: string,
  bugs: readonly ObserverBug[],
): string {
  const { bugsOpen } = atlasObserverPaths(workspaceRoot);
  mkdirSync(dirname(bugsOpen), { recursive: true });
  writeFileSync(bugsOpen, JSON.stringify(bugs, null, 2), "utf8");
  return bugsOpen;
}

export function ingestBugs(
  workspaceRoot: string,
  inputs: readonly BugIngestInput[],
  projectId?: string | null,
): ObserverBug[] {
  const existing = loadBugs(workspaceRoot);
  const created = inputs.map((b) =>
    createBug({ ...b, projectId: b.projectId ?? projectId ?? null }),
  );
  const merged = [...existing, ...created];
  saveBugs(workspaceRoot, merged);
  return merged;
}
