/**
 * Atlas Sentinel — S1.2 Dependency security (allowlisted advisories only).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFENSIVE_ADVISORIES,
  isVersionBelow,
} from "./advisories.js";

export interface DependencyFinding {
  readonly id: string;
  readonly kind: "dependency_advisory";
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly packageName: string;
  readonly installed: string;
  readonly advisoryId: string;
  readonly sourceUrl: string;
  readonly evidenceRefs: readonly string[];
  readonly claim: "OBSERVED";
  readonly epistemicState: "OBSERVED";
  readonly remediation: string;
}

function readPackageJson(root: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
  const file = join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

/** Best-effort exact version from lockfiles when present. */
function lockfileHint(root: string, packageName: string): string | null {
  for (const lock of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    const full = join(root, lock);
    if (!existsSync(full)) continue;
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.length > 2_000_000) continue;
    const pnpm = new RegExp(
      `^\\s{2}${packageName}@[^:\\n]+:\\s*\\n(?:.*\\n)*?\\s{4}version:\\s*['"]?([0-9][^\\s'"]+)`,
      "m",
    );
    const m1 = pnpm.exec(text);
    if (m1?.[1]) return m1[1];
    const npm = new RegExp(
      `"node_modules/${packageName}"\\s*:\\s*\\{[\\s\\S]*?"version"\\s*:\\s*"([^"]+)"`,
    );
    const m2 = npm.exec(text);
    if (m2?.[1]) return m2[1];
  }
  return null;
}

export function detectDependencyAdvisories(
  workspaceRoot: string,
): DependencyFinding[] {
  const pkg = readPackageJson(workspaceRoot);
  if (!pkg) return [];
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const findings: DependencyFinding[] = [];

  for (const adv of DEFENSIVE_ADVISORIES) {
    const declared = deps[adv.packageName];
    if (!declared) continue;
    const locked = lockfileHint(workspaceRoot, adv.packageName);
    const installed = locked ?? declared;
    if (!isVersionBelow(installed, adv.vulnerableBelow)) continue;
    findings.push({
      id: `dep:${adv.id}:${adv.packageName}`,
      kind: "dependency_advisory",
      severity: adv.severity,
      title: `${adv.title} · ${adv.packageName}@${installed}`,
      detail: `Declared/resolved ${adv.packageName}@${installed} is below fixed ${adv.vulnerableBelow}. Source: ${adv.sourceUrl}`,
      path: locked ? "lockfile" : "package.json",
      packageName: adv.packageName,
      installed,
      advisoryId: adv.id,
      sourceUrl: adv.sourceUrl,
      evidenceRefs: [
        `advisory:${adv.id}`,
        `package:${adv.packageName}@${installed}`,
        `vulnerableBelow:${adv.vulnerableBelow}`,
        `source:${adv.sourceUrl}`,
        locked ? "evidence:lockfile" : "evidence:package.json-range",
      ],
      claim: "OBSERVED",
      epistemicState: "OBSERVED",
      remediation: `Upgrade ${adv.packageName} to ≥ ${adv.vulnerableBelow} · re-lock · re-run Sentinel verify`,
    });
  }

  return findings;
}
