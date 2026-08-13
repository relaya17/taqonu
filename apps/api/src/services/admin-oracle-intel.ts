/**
 * Admin Oracle A1.3–A1.5 — version instability + defensive advisory match.
 * Allowlisted catalogs only (no open-web scrape, no offensive tooling).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFENSIVE_ADVISORIES,
  isVersionBelow,
} from "@atlas/observer";
import { osStore } from "../store/os-store.js";

export { isVersionBelow };
export interface VersionFinding {
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "info";
  readonly title: string;
  readonly detail: string;
  readonly evidenceRefs: readonly string[];
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly packageName: string | null;
  readonly current: string | null;
  readonly recommendation: string;
}

export interface CyberFinding {
  readonly id: string;
  readonly advisoryId: string;
  readonly severity: "critical" | "high" | "medium";
  readonly title: string;
  readonly detail: string;
  readonly packageName: string;
  readonly installed: string;
  readonly sourceUrl: string;
  readonly evidenceRefs: readonly string[];
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly remediation: string;
}

/** Public EOL dates — Node.js release schedule (allowlisted vendor fact). */
const NODE_EOL: ReadonlyArray<{
  readonly major: number;
  readonly eol: string;
  readonly label: string;
}> = [
  { major: 16, eol: "2023-09-11", label: "Node.js 16" },
  { major: 18, eol: "2025-04-30", label: "Node.js 18" },
  { major: 20, eol: "2026-04-30", label: "Node.js 20" },
  { major: 21, eol: "2024-06-01", label: "Node.js 21 (odd)" },
  { major: 22, eol: "2027-04-30", label: "Node.js 22" },
];

function readPackageJson(root: string): {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
} | null {
  const file = join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as {
      engines?: { node?: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      name?: string;
    };
  } catch {
    return null;
  }
}

function collectDeps(
  pkg: NonNullable<ReturnType<typeof readPackageJson>>,
): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
}

function extractMajorFromEngine(engine: string): number | null {
  const m = engine.match(/(\d{2,})/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function detectVersionInstability(): VersionFinding[] {
  const findings: VersionFinding[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const hostMajor = extractMajorFromEngine(process.versions.node);
  if (hostMajor !== null) {
    const eol = NODE_EOL.find((e) => e.major === hostMajor);
    if (eol && eol.eol <= today) {
      findings.push({
        id: `version:host-node-${hostMajor}`,
        severity: "high",
        title: `${eol.label} is past EOL on API host`,
        detail: `Host Node ${process.versions.node} · EOL ${eol.eol}.`,
        evidenceRefs: [
          `host:node:${process.versions.node}`,
          `eol:${eol.eol}`,
          "source:nodejs.org release schedule",
        ],
        projectId: null,
        projectName: null,
        packageName: "node",
        current: process.versions.node,
        recommendation: "Upgrade API host to an active LTS (Node 22+).",
      });
    }
  }

  for (const project of osStore.listProjects()) {
    const root = osStore.getWorkspaceRoot(project.id);
    if (!root || !existsSync(root)) continue;
    const pkg = readPackageJson(root);
    if (!pkg) continue;

    const engine = pkg.engines?.node;
    if (engine) {
      const major = extractMajorFromEngine(engine);
      const eol = major !== null ? NODE_EOL.find((e) => e.major === major) : null;
      if (eol && eol.eol <= today) {
        findings.push({
          id: `version:${project.id}:engines-node-${major}`,
          severity: "high",
          title: `${project.name}: engines.node targets EOL runtime`,
          detail: `package.json engines.node="${engine}" · ${eol.label} EOL ${eol.eol}.`,
          evidenceRefs: [
            `project:${project.slug}`,
            `engines.node:${engine}`,
            `eol:${eol.eol}`,
          ],
          projectId: project.id,
          projectName: project.name,
          packageName: "node",
          current: engine,
          recommendation: "Bump engines.node to active LTS and retest.",
        });
      }
    }

    const deps = collectDeps(pkg);
    for (const [name, range] of Object.entries(deps)) {
      if (name === "next") {
        const major = extractMajorFromEngine(range);
        if (major !== null && major < 14) {
          findings.push({
            id: `version:${project.id}:next-${major}`,
            severity: "medium",
            title: `${project.name}: Next.js major looks stale`,
            detail: `Declared next@${range} (major ${major}). Prefer current stable line.`,
            evidenceRefs: [`dep:next:${range}`, "source:next.js releases"],
            projectId: project.id,
            projectName: project.name,
            packageName: "next",
            current: range,
            recommendation: "Plan upgrade to supported Next.js major.",
          });
        }
      }
      if (name === "react") {
        const major = extractMajorFromEngine(range);
        if (major !== null && major < 18) {
          findings.push({
            id: `version:${project.id}:react-${major}`,
            severity: "medium",
            title: `${project.name}: React major below 18`,
            detail: `Declared react@${range}.`,
            evidenceRefs: [`dep:react:${range}`, "source:react releases"],
            projectId: project.id,
            projectName: project.name,
            packageName: "react",
            current: range,
            recommendation: "Upgrade React to 18+ / 19 with regression tests.",
          });
        }
      }
      if (name === "typescript") {
        const major = extractMajorFromEngine(range);
        if (major !== null && major < 5) {
          findings.push({
            id: `version:${project.id}:typescript-${major}`,
            severity: "medium",
            title: `${project.name}: TypeScript major below 5`,
            detail: `Declared typescript@${range}.`,
            evidenceRefs: [`dep:typescript:${range}`, "source:typescript releases"],
            projectId: project.id,
            projectName: project.name,
            packageName: "typescript",
            current: range,
            recommendation: "Upgrade TypeScript to 5.x and fix breaking type errors.",
          });
        }
      }
      if (name === "pg" || name === "postgres") {
        const major = extractMajorFromEngine(range);
        if (major !== null && major < 8) {
          findings.push({
            id: `version:${project.id}:${name}-${major}`,
            severity: "medium",
            title: `${project.name}: ${name} major looks stale`,
            detail: `Declared ${name}@${range}. Prefer current maintained major.`,
            evidenceRefs: [`dep:${name}:${range}`, "source:postgres.js / node-postgres releases"],
            projectId: project.id,
            projectName: project.name,
            packageName: name,
            current: range,
            recommendation: `Upgrade ${name} and re-run integration tests.`,
          });
        }
      }
    }
  }

  return findings;
}

export function detectDefensiveCyberMatches(): CyberFinding[] {
  const findings: CyberFinding[] = [];
  for (const project of osStore.listProjects()) {
    const root = osStore.getWorkspaceRoot(project.id);
    if (!root || !existsSync(root)) continue;
    const pkg = readPackageJson(root);
    if (!pkg) continue;
    const deps = collectDeps(pkg);
    for (const adv of DEFENSIVE_ADVISORIES) {
      const installed = deps[adv.packageName];
      if (!installed) continue;
      if (!isVersionBelow(installed, adv.vulnerableBelow)) continue;
      findings.push({
        id: `cyber:${project.id}:${adv.id}`,
        advisoryId: adv.id,
        severity: adv.severity.toLowerCase() as "critical" | "high" | "medium",
        title: `${adv.title} · ${adv.packageName}@${installed}`,
        detail: `${project.name} declares ${adv.packageName}@${installed} below ${adv.vulnerableBelow}.`,
        packageName: adv.packageName,
        installed,
        sourceUrl: adv.sourceUrl,
        evidenceRefs: [
          `advisory:${adv.id}`,
          `package:${adv.packageName}@${installed}`,
          `vulnerableBelow:${adv.vulnerableBelow}`,
          `source:${adv.sourceUrl}`,
        ],
        projectId: project.id,
        projectName: project.name,
        remediation: `Upgrade ${adv.packageName} to ≥ ${adv.vulnerableBelow} and re-lock deps.`,
      });
    }
  }
  return findings;
}
