import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ASSIST_CREDIT_COST,
  CREDIT_PACKS,
  EXPERT_CATALOG,
  FREE_MONTHLY_ASSIST_CREDITS,
  PRO_MONTHLY_ASSIST_CREDITS,
  STUB_OWNER_ID,
  artifactSchema,
  assistRunSchema,
  creditsBalanceSchema,
  evidenceRecordSchema,
  type Artifact,
  type AssistRun,
  type CreateArtifact,
  type CreateAssistRun,
  type CreditsBalance,
  type EvidenceRecord,
} from "@atlas/shared";
import { redactSecrets } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";

function atlasRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function inferKind(
  mime: string,
  filename: string,
): Artifact["kind"] {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    return "PDF";
  }
  if (
    mime.includes("markdown") ||
    filename.toLowerCase().endsWith(".md")
  ) {
    return "MARKDOWN";
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("document") ||
    /\.(docx?|txt|rtf)$/i.test(filename)
  ) {
    return "DOCUMENT";
  }
  return "OTHER";
}

export function ensureCreditsInitialized(tier: "free" | "pro"): CreditsBalance {
  const existing = osStore.getCredits();
  if (existing) {
    return creditsBalanceSchema.parse(existing);
  }
  const grant =
    tier === "pro" ? PRO_MONTHLY_ASSIST_CREDITS : FREE_MONTHLY_ASSIST_CREDITS;
  const now = new Date().toISOString();
  const balance = {
    balance: grant,
    lifetimeGranted: grant,
    lifetimeSpent: 0,
    freeGrant: grant,
    updatedAt: now,
  };
  osStore.setCredits(balance);
  return creditsBalanceSchema.parse(balance);
}

export function chargeCredits(amount: number): CreditsBalance {
  const current = ensureCreditsInitialized("free");
  if (amount > current.balance) {
    throw new Error("INSUFFICIENT_CREDITS");
  }
  const next = {
    ...current,
    balance: current.balance - amount,
    lifetimeSpent: current.lifetimeSpent + amount,
    updatedAt: new Date().toISOString(),
  };
  osStore.setCredits(next);
  return creditsBalanceSchema.parse(next);
}

export function purchaseCreditPack(
  pack: keyof typeof CREDIT_PACKS,
): CreditsBalance {
  const current = ensureCreditsInitialized("free");
  const add = CREDIT_PACKS[pack].credits;
  const next = {
    ...current,
    balance: current.balance + add,
    lifetimeGranted: current.lifetimeGranted + add,
    updatedAt: new Date().toISOString(),
  };
  osStore.setCredits(next);
  osStore.appendAudit({
    type: "billing.credits.purchase",
    pack,
    credits: add,
    at: next.updatedAt,
  });
  return creditsBalanceSchema.parse(next);
}

export function createArtifactFromUpload(
  input: CreateArtifact,
): { artifact: Artifact; evidence: EvidenceRecord } {
  const raw = Buffer.from(input.contentBase64, "base64");
  const maxBytes = 5 * 1024 * 1024;
  if (raw.byteLength === 0 || raw.byteLength > maxBytes) {
    throw new Error("INVALID_SIZE");
  }
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const id = crypto.randomUUID();
  const kind = input.kind ?? inferKind(input.mimeType, input.filename);
  const dir = resolve(atlasRoot(), ".atlas", "artifacts");
  mkdirSync(dir, { recursive: true });
  const safeName = input.filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
  const storagePath = resolve(dir, `${id}-${safeName}`);
  writeFileSync(storagePath, raw);

  const now = new Date().toISOString();
  const evidenceId = crypto.randomUUID();
  const projectKey = input.projectId ?? "global";
  const evidence = evidenceRecordSchema.parse({
    id: evidenceId,
    ownerId: STUB_OWNER_ID,
    projectId: input.projectId ?? null,
    source: `artifact:${input.filename}`,
    sourceType: "ARTIFACT",
    sourceId: id,
    uri: storagePath,
    excerpt: input.note ?? `Uploaded ${input.filename} (${raw.byteLength} bytes)`,
    version: sha256.slice(0, 12),
    observedAt: now,
    createdAt: now,
    confidence: 1,
    epistemicState: "FACT",
    metadata: {
      mimeType: input.mimeType,
      kind,
      byteSize: raw.byteLength,
      sha256,
    },
  });
  osStore.addEvidence(projectKey, [evidence]);

  const artifact = artifactSchema.parse({
    id,
    projectId: input.projectId ?? null,
    filename: input.filename,
    mimeType: input.mimeType,
    kind,
    byteSize: raw.byteLength,
    sha256,
    storagePath,
    evidenceId,
    note: input.note ?? null,
    createdAt: now,
  });
  osStore.upsertArtifact(artifact);
  osStore.appendAudit({
    type: "artifact.created",
    artifactId: id,
    evidenceId,
    at: now,
  });
  return { artifact, evidence };
}

export async function runAssist(
  input: CreateAssistRun,
  options?: { openaiKey?: string },
): Promise<AssistRun> {
  const provider = input.provider ?? "local-checklist";
  const cost = ASSIST_CREDIT_COST[provider];
  if (cost > 0) {
    try {
      chargeCredits(cost);
    } catch {
      throw new Error("INSUFFICIENT_CREDITS");
    }
  }

  const artifacts = input.artifactIds.map((id) => {
    const a = osStore.getArtifact(id);
    if (!a) throw new Error(`ARTIFACT_MISSING:${id}`);
    return a;
  });

  const expert = EXPERT_CATALOG[input.expertId];
  const now = new Date().toISOString();
  const findings = [];

  if (provider === "local-checklist") {
    for (const item of expert.checklist.slice(0, 5)) {
      findings.push({
        id: crypto.randomUUID(),
        title: item,
        detail: `Checklist item for ${artifacts.map((a) => a.filename).join(", ")} — free ArletOS checklist.`,
        severity: "MEDIUM" as const,
        epistemicState: "INFERRED" as const,
      });
    }
  } else if (!options?.openaiKey) {
    findings.push({
      id: crypto.randomUUID(),
      title: "GPT-4o Vision unavailable",
      detail:
        "OPENAI_API_KEY not set. Use ArletOS Checklist (free) or set the key.",
      severity: "HIGH" as const,
      epistemicState: "UNKNOWN" as const,
    });
  } else {
    const image = artifacts.find((a) => a.kind === "IMAGE");
    try {
      const safeRequest = redactSecrets(input.userRequest);
      const body = {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: redactSecrets(
              `${expert.systemDiscipline}\nReturn short bullet findings. Label INFERRED/PROPOSED. Never invent FACT about code.`,
            ),
          },
          {
            role: "user",
            content: image
              ? [
                  { type: "text", text: safeRequest },
                  {
                    type: "text",
                    text: `Image file: ${image.filename}, sha ${image.sha256}. Describe UX review dimensions.`,
                  },
                ]
              : `${safeRequest}\nArtifacts: ${artifacts.map((a) => a.filename).join(", ")}`,
          },
        ],
        max_tokens: 600,
      };
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      const text = redactSecrets(
        json.choices?.[0]?.message?.content ??
          json.error?.message ??
          "No model response",
      );
      findings.push({
        id: crypto.randomUUID(),
        title: "GPT-4o Vision",
        detail: text.slice(0, 1900),
        severity: "MEDIUM" as const,
        epistemicState: "INFERRED" as const,
      });
    } catch (error) {
      findings.push({
        id: crypto.randomUUID(),
        title: "GPT-4o Vision call failed",
        detail: error instanceof Error ? error.message : "unknown error",
        severity: "HIGH" as const,
        epistemicState: "UNKNOWN" as const,
      });
    }
  }

  const run = assistRunSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    artifactIds: input.artifactIds,
    expertId: input.expertId,
    provider,
    userRequest: input.userRequest,
    summary: `${expert.titleEn} assist via ${provider} · ${findings.length} findings · ${cost} credits`,
    findings,
    creditsCharged: cost,
    epistemicState: "INFERRED",
    createdAt: now,
  });
  osStore.addAssistRun(run);
  osStore.appendAudit({
    type: "assist.run.completed",
    runId: run.id,
    provider: run.provider,
    credits: cost,
    at: now,
  });
  return run;
}
