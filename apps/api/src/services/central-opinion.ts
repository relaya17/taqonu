import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  memorySchema,
  type Memory,
  type ProcessAuditDocument,
  type ProcessVerdict,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";

const PROCESS_AUDIT_INDEX = "qa.processAudit.index";
const MAX_INDEX = 50;

export interface ProjectReachability {
  projectId: string;
  projectName: string;
  local: {
    path: string | null;
    reachable: boolean;
    note: string;
  };
  repo: {
    cloudSynced: boolean;
    cloudProjectId: string | null;
    note: string;
  };
  canOpenFiles: boolean;
  canRunStudio: boolean;
  overall: "READY" | "PARTIAL" | "BLOCKED";
}

export interface CentralOpinion {
  id: string;
  projectId: string;
  projectName: string;
  generatedAt: string;
  reachability: ProjectReachability;
  verdict: ProcessVerdict | "INSUFFICIENT_EVIDENCE";
  executiveOpinion: string;
  findings: Array<{
    source: string;
    severity: string;
    title: string;
  }>;
  processAuditIds: string[];
  memoryReminders: string[];
  markdown: string;
  html: string;
}

function loadAuditIndex(): string[] {
  const raw = osStore.getMeta(PROCESS_AUDIT_INDEX);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberProcessAuditId(auditId: string): void {
  const next = [auditId, ...loadAuditIndex().filter((id) => id !== auditId)].slice(
    0,
    MAX_INDEX,
  );
  osStore.setMeta(PROCESS_AUDIT_INDEX, JSON.stringify(next));
}

export function loadProcessAudit(auditId: string): ProcessAuditDocument | null {
  const raw = osStore.getMeta(`qa.processAudit.${auditId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProcessAuditDocument;
  } catch {
    return null;
  }
}

export function listProcessAuditsForProject(
  projectId: string | null,
): ProcessAuditDocument[] {
  const out: ProcessAuditDocument[] = [];
  for (const id of loadAuditIndex()) {
    const doc = loadProcessAudit(id);
    if (!doc) continue;
    if (projectId && doc.projectId && doc.projectId !== projectId) continue;
    if (projectId && !doc.projectId) continue;
    out.push(doc);
  }
  return out;
}

export function resolveProjectReachability(projectId: string): ProjectReachability {
  const project = osStore.getProject(projectId);
  if (!project) {
    return {
      projectId,
      projectName: "unknown",
      local: {
        path: null,
        reachable: false,
        note: "Project not found",
      },
      repo: {
        cloudSynced: false,
        cloudProjectId: null,
        note: "Project not found",
      },
      canOpenFiles: false,
      canRunStudio: false,
      overall: "BLOCKED",
    };
  }

  const root = osStore.getWorkspaceRoot(projectId) ?? null;
  const resolved = root ? resolve(root) : null;
  const localOk = Boolean(resolved && existsSync(resolved));
  const link = osStore.getCloudLink(projectId);

  const local = {
    path: resolved,
    reachable: localOk,
    note: localOk
      ? "Local workspace reachable on API host — Studio/file browse available."
      : root
        ? "workspaceRoot set but path not found on API host (cloud deploy cannot see your PC path)."
        : "No local workspaceRoot linked — link a folder under Projects, or use a GitHub-connected import.",
  };

  const repo = {
    cloudSynced: Boolean(link),
    cloudProjectId: link?.cloudProjectId ?? null,
    note: link
      ? "Cloud/repo link present — evidence can sync; deep file audit still needs a local clone path on the API host."
      : "No cloud project link yet — connect GitHub/import under Projects for repo reachability.",
  };

  const canOpenFiles = localOk;
  const canRunStudio = localOk;
  let overall: ProjectReachability["overall"] = "BLOCKED";
  if (localOk && link) overall = "READY";
  else if (localOk || link) overall = "PARTIAL";

  return {
    projectId,
    projectName: project.name,
    local,
    repo,
    canOpenFiles,
    canRunStudio,
    overall,
  };
}

function worstVerdict(
  a: ProcessVerdict | "INSUFFICIENT_EVIDENCE",
  b: ProcessVerdict,
): ProcessVerdict | "INSUFFICIENT_EVIDENCE" {
  const rank = {
    NO_GO: 3,
    CONDITIONAL_GO: 2,
    GO: 1,
    INSUFFICIENT_EVIDENCE: 0,
  } as const;
  return rank[b] >= rank[a] ? b : a;
}

/** Persist process-audit outcome into Memory so the companion can remind later. */
export function syncProcessAuditToMemory(doc: ProcessAuditDocument): Memory {
  const now = new Date().toISOString();
  const blockers = doc.sections.blockers.slice(0, 5).join("; ") || "none";
  const defects = doc.sections.defects.slice(0, 5).join("; ") || "none";
  const statement = [
    `E2E process audit [${doc.verdict}] profile=${doc.appProfile}`,
    `opinion: ${doc.verdictReason}`,
    `blockers: ${blockers}`,
    `defects: ${defects}`,
    `auditId=${doc.id}`,
  ].join(" | ");

  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    type: "EVENT",
    projectId: doc.projectId,
    statement: statement.slice(0, 4000),
    reason: [
      "source:process-audit",
      `auditId:${doc.id}`,
      `verdict:${doc.verdict}`,
      "partner:manager-agent",
    ],
    status: "ACTIVE",
    confidence: 0.9,
    category: "DECISION_MEMORY",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "process-audit",
    sourceType: "AGENT",
    sourceId: doc.id,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "process-agent",
    scope: doc.projectId ? "PROJECT" : "GLOBAL",
    priority: doc.verdict === "NO_GO" ? "CRITICAL" : "HIGH",
  });
  osStore.addMemory(memory);
  return memory;
}

export function listManagerPartnerReminders(projectId: string | null): string[] {
  const memories =
    projectId != null
      ? osStore.getMemories(projectId)
      : osStore.listProjects().flatMap((p) => osStore.getMemories(p.id));
  return memories
    .filter(
      (m) =>
        m.status === "ACTIVE" &&
        (m.source === "process-audit" ||
          m.source === "studio" ||
          m.reason.some((r) => r.includes("process-audit") || r.includes("Studio"))),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((m) => `[${m.type}] ${m.statement}`);
}

export function buildCentralOpinion(projectId: string): CentralOpinion {
  const project = osStore.getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  const reachability = resolveProjectReachability(projectId);
  const audits = listProcessAuditsForProject(projectId);
  const reminders = listManagerPartnerReminders(projectId);
  const now = new Date().toISOString();

  let verdict: ProcessVerdict | "INSUFFICIENT_EVIDENCE" = "INSUFFICIENT_EVIDENCE";
  const findings: CentralOpinion["findings"] = [];

  for (const audit of audits) {
    verdict = worstVerdict(verdict, audit.verdict);
    for (const item of audit.items) {
      if (item.kind === "BLOCKER" || item.kind === "DEFECT") {
        findings.push({
          source: `E2E:${audit.id.slice(0, 8)}`,
          severity: item.severity,
          title: item.title,
        });
      }
    }
  }

  for (const m of osStore.getMemories(projectId).slice(-30)) {
    if (m.type === "BUG" || m.priority === "CRITICAL" || m.priority === "HIGH") {
      findings.push({
        source: `memory:${m.type}`,
        severity: m.priority,
        title: m.statement.slice(0, 200),
      });
    }
  }

  const executiveOpinion =
    verdict === "INSUFFICIENT_EVIDENCE"
      ? "Insufficient synchronized evidence for a single central opinion — run an E2E process audit and ensure local/repo reachability."
      : verdict === "NO_GO"
        ? `Central opinion: NO-GO. ${audits[0]?.verdictReason ?? "Critical process gaps remain."} Manager-partner agent retains audit memory for follow-up reminders.`
        : verdict === "CONDITIONAL_GO"
          ? `Central opinion: CONDITIONAL GO. Address listed blockers/defects, then re-audit. Reachability: ${reachability.overall}.`
          : `Central opinion: GO on current synchronized evidence. Continue manager-partner tracking of process runs. Reachability: ${reachability.overall}.`;

  const markdown = [
    `# Central opinion — ${project.name}`,
    ``,
    `Generated: ${now}`,
    `Verdict: **${verdict}**`,
    ``,
    `## Executive opinion`,
    executiveOpinion,
    ``,
    `## Project reachability (local PC / repo)`,
    `- Overall: ${reachability.overall}`,
    `- Local: ${reachability.local.reachable ? "OK" : "NO"} — ${reachability.local.path ?? "n/a"}`,
    `  - ${reachability.local.note}`,
    `- Repo/cloud: ${reachability.repo.cloudSynced ? "linked" : "not linked"}`,
    `  - ${reachability.repo.note}`,
    `- Studio / file browse: ${reachability.canOpenFiles ? "available" : "unavailable"}`,
    ``,
    `## Consolidated findings`,
    ...(findings.length
      ? findings
          .slice(0, 40)
          .map((f) => `- [${f.severity}] (${f.source}) ${f.title}`)
      : ["- none yet"]),
    ``,
    `## Manager-partner reminders (synced memory)`,
    ...(reminders.length ? reminders.map((r) => `- ${r}`) : ["- none yet"]),
    ``,
    `## Process audits included`,
    ...(audits.length
      ? audits.map(
          (a) =>
            `- ${a.id} · ${a.verdict} · ${a.appProfile} · ${a.completedAt}`,
        )
      : ["- none"]),
    ``,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>Central opinion — ${escapeHtml(project.name)}</title>
  <style>
    body { font-family: "Segoe UI", Rubik, Arial, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #142022; line-height: 1.5; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1.15rem; margin-top: 1.5rem; }
    .verdict { padding: 0.75rem 1rem; border-radius: 8px; background: #e8eef0; font-weight: 700; }
    ul { padding-inline-start: 1.2rem; }
    @media print { button { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Save / Print as PDF</button>
  <h1>Central opinion — ${escapeHtml(project.name)}</h1>
  <p>Generated: ${escapeHtml(now)}</p>
  <p class="verdict">Verdict: ${escapeHtml(verdict)}</p>
  <h2>Executive opinion</h2>
  <p>${escapeHtml(executiveOpinion)}</p>
  <h2>Reachability</h2>
  <ul>
    <li>Overall: ${escapeHtml(reachability.overall)}</li>
    <li>Local: ${reachability.local.reachable ? "OK" : "NO"} — ${escapeHtml(reachability.local.path ?? "n/a")}</li>
    <li>${escapeHtml(reachability.local.note)}</li>
    <li>Repo/cloud: ${reachability.repo.cloudSynced ? "linked" : "not linked"}</li>
    <li>${escapeHtml(reachability.repo.note)}</li>
  </ul>
  <h2>Findings</h2>
  <ul>
    ${
      findings.length
        ? findings
            .slice(0, 40)
            .map(
              (f) =>
                `<li>[${escapeHtml(f.severity)}] (${escapeHtml(f.source)}) ${escapeHtml(f.title)}</li>`,
            )
            .join("")
        : "<li>none yet</li>"
    }
  </ul>
  <h2>Manager-partner reminders</h2>
  <ul>
    ${
      reminders.length
        ? reminders.map((r) => `<li>${escapeHtml(r)}</li>`).join("")
        : "<li>none yet</li>"
    }
  </ul>
  <script>/* Print from browser to get a PDF on the customer's computer */</script>
</body>
</html>`;

  return {
    id: crypto.randomUUID(),
    projectId,
    projectName: project.name,
    generatedAt: now,
    reachability,
    verdict,
    executiveOpinion,
    findings: findings.slice(0, 60),
    processAuditIds: audits.map((a) => a.id),
    memoryReminders: reminders,
    markdown,
    html,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal single-page PDF (Latin-1 safe summary). Full bilingual report: use HTML print.
 */
export function buildCentralOpinionPdfBytes(opinion: CentralOpinion): Uint8Array {
  const lines = [
    `Central opinion: ${opinion.projectName}`,
    `Generated: ${opinion.generatedAt}`,
    `Verdict: ${opinion.verdict}`,
    "",
    opinion.executiveOpinion,
    "",
    `Reachability: ${opinion.reachability.overall}`,
    `Local: ${opinion.reachability.local.reachable ? "OK" : "NO"} ${opinion.reachability.local.path ?? ""}`,
    `Repo: ${opinion.reachability.repo.cloudSynced ? "linked" : "not linked"}`,
    "",
    "Findings:",
    ...opinion.findings.slice(0, 25).map((f) => `- [${f.severity}] ${f.title}`),
    "",
    "Reminders:",
    ...opinion.memoryReminders.slice(0, 15).map((r) => `- ${r}`),
    "",
    "(Full RTL/Hebrew layout: open HTML print endpoint.)",
  ].map((l) => l.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?"));

  const contentLines = [
    "BT",
    "/F1 11 Tf",
    "50 780 Td",
    "14 TL",
    ...lines.flatMap((line, i) => {
      const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      return i === 0 ? [`(${safe}) Tj`] : ["T*", `(${safe}) Tj`];
    }),
    "ET",
  ];
  const stream = contentLines.join("\n");
  const objs: string[] = [];
  objs.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj");
  objs.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj");
  objs.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
  );
  objs.push(
    `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream endobj`,
  );
  objs.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj + "\n";
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "utf8"));
}
