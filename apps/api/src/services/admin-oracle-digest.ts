/**
 * Admin Oracle A1.4 / A1.6 / A1.7 — daily brief, audit trail, morning digest.
 */
import type { OracleActionQueue } from "./admin-oracle-queue.js";
import {
  detectDefensiveCyberMatches,
  detectVersionInstability,
  type CyberFinding,
  type VersionFinding,
} from "./admin-oracle-intel.js";
import { buildAdminOracleShell } from "./admin-oracle.js";
import { osStore } from "../store/os-store.js";

export interface OracleAuditEntry {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly summary: string;
  readonly actor: string;
  readonly meta?: Record<string, string | number | boolean | null>;
}

export interface OracleDailyBrief {
  readonly date: string;
  readonly headline: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly epistemicState: "OBSERVED" | "INFERRED" | "PROPOSED" | "UNKNOWN";
    readonly sourceId: string;
    readonly actionHint: string;
  }[];
  readonly versionFindings: number;
  readonly cyberFindings: number;
  readonly queueTotal: number;
  readonly note: string;
}

export interface OracleMorningDigest {
  readonly date: string;
  readonly summary: string;
  readonly top3: readonly {
    readonly id: string;
    readonly title: string;
    readonly severity: string;
    readonly href: string;
    readonly cta: string;
  }[];
  readonly brief: OracleDailyBrief;
  readonly auditTail: readonly OracleAuditEntry[];
}

function readAudit(): OracleAuditEntry[] {
  const raw = osStore.getMeta("admin.oracle.audit");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OracleAuditEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function appendOracleAudit(entry: Omit<OracleAuditEntry, "id" | "at"> & {
  readonly id?: string;
  readonly at?: string;
}): OracleAuditEntry {
  const full: OracleAuditEntry = {
    id: entry.id ?? crypto.randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    type: entry.type,
    summary: entry.summary,
    actor: entry.actor,
    ...(entry.meta ? { meta: entry.meta } : {}),
  };
  const next = [full, ...readAudit()].slice(0, 50);
  osStore.setMeta("admin.oracle.audit", JSON.stringify(next));
  return full;
}

export function buildOracleDailyBrief(input: {
  readonly queue: OracleActionQueue;
  readonly versions: readonly VersionFinding[];
  readonly cyber: readonly CyberFinding[];
}): OracleDailyBrief {
  const shell = buildAdminOracleShell({ locale: "he" });
  const date = new Date().toISOString().slice(0, 10);
  const items = [...shell.dailyBrief.items];

  if (input.versions[0]) {
    items.unshift({
      id: "brief-version-live",
      title: input.versions[0].title,
      detail: input.versions[0].detail,
      epistemicState: "OBSERVED",
      sourceId: "nodejs-releases",
      actionHint: input.versions[0].recommendation,
    });
  }
  if (input.cyber[0]) {
    items.unshift({
      id: "brief-cyber-live",
      title: input.cyber[0].title,
      detail: input.cyber[0].detail,
      epistemicState: "INFERRED",
      sourceId: "nvd",
      actionHint: input.cyber[0].remediation,
    });
  }
  if (input.queue.top[0]) {
    items.unshift({
      id: "brief-queue-top",
      title: `Top queue: ${input.queue.top[0].title}`,
      detail: input.queue.top[0].detail,
      epistemicState: "OBSERVED",
      sourceId: "atlas-truth",
      actionHint: input.queue.top[0].cta,
    });
  }

  const critical =
    input.queue.counts.critical +
    input.versions.filter((v) => v.severity === "critical").length +
    input.cyber.filter((c) => c.severity === "critical").length;

  return {
    date,
    headline:
      critical > 0
        ? `Oracle brief · ${critical} critical signal(s) need attention`
        : `Oracle brief · ${input.queue.total} queued · ${input.versions.length} version · ${input.cyber.length} cyber`,
    items: items.slice(0, 8),
    versionFindings: input.versions.length,
    cyberFindings: input.cyber.length,
    queueTotal: input.queue.total,
    note: "Allowlisted vendor/CVE facts + internal Truth signals. No open-web scrape.",
  };
}

export function buildOracleMorningDigest(input: {
  readonly queue: OracleActionQueue;
}): {
  readonly digest: OracleMorningDigest;
  readonly versions: readonly VersionFinding[];
  readonly cyber: readonly CyberFinding[];
} {
  const versions = detectVersionInstability();
  const cyber = detectDefensiveCyberMatches();
  const brief = buildOracleDailyBrief({
    queue: input.queue,
    versions,
    cyber,
  });

  const merged = [
    ...input.queue.top.map((a) => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      href: a.href,
      cta: a.cta,
      priority: a.priority,
    })),
    ...versions.map((v) => ({
      id: v.id,
      title: v.title,
      severity: v.severity,
      href: "/admin/oracle",
      cta: v.recommendation,
      priority:
        v.severity === "critical"
          ? 100
          : v.severity === "high"
            ? 80
            : v.severity === "medium"
              ? 50
              : 20,
    })),
    ...cyber.map((c) => ({
      id: c.id,
      title: c.title,
      severity: c.severity,
      href: c.sourceUrl,
      cta: c.remediation,
      priority:
        c.severity === "critical" ? 100 : c.severity === "high" ? 85 : 55,
    })),
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  const digest: OracleMorningDigest = {
    date: brief.date,
    summary: brief.headline,
    top3: merged.map(({ id, title, severity, href, cta }) => ({
      id,
      title,
      severity,
      href,
      cta,
    })),
    brief,
    auditTail: readAudit().slice(0, 8),
  };

  osStore.setMeta(
    `admin.oracle.brief.${digest.date}`,
    JSON.stringify(brief),
  );
  osStore.setMeta(
    "admin.oracle.digest.last",
    JSON.stringify({
      at: new Date().toISOString(),
      date: digest.date,
      topIds: digest.top3.map((t) => t.id),
      versionFindings: versions.length,
      cyberFindings: cyber.length,
      staleAfterHours: 24,
    }),
  );
  osStore.setMeta("admin.oracle.digest.snapshot", JSON.stringify(digest));

  return { digest, versions, cyber };
}

export function listOracleAudit(limit = 30): readonly OracleAuditEntry[] {
  return readAudit().slice(0, limit);
}
