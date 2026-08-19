import type { FastifyInstance } from "fastify";
import {
  listExperts,
  selectExperts,
  buildExpertSystemBlock,
  runExpertReview,
} from "@atlas/experts";
import {
  createEditorBriefSchema,
  createExpertReviewSchema,
  editorBriefSchema,
  EXPERT_CATALOG,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { assertProjectReadAccess } from "../services/project-access.js";
import { requireUser } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

export async function registerExpertRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/experts", async () => ({
    items: listExperts().map((expert) => ({
      id: expert.id,
      titleHe: expert.titleHe,
      titleEn: expert.titleEn,
      titleAr: expert.titleAr,
      focus: expert.focus,
      checklist: expert.checklist,
      domain: expert.domain,
      requiredEvidence: expert.requiredEvidence,
      forbiddenAssumptions: expert.forbiddenAssumptions,
      evaluationCriteria: expert.evaluationCriteria,
      fabricAgentIds: expert.fabricAgentIds,
      styleLanes: expert.styleLanes ?? [],
      budgetHintEn: expert.budgetHintEn,
      budgetHintHe: expert.budgetHintHe,
      budgetHintAr: expert.budgetHintAr,
    })),
  }));

  app.post("/api/v1/experts/select", async (request) => {
    const body = (request.body ?? {}) as {
      userRequest?: string;
      experts?: Array<keyof typeof EXPERT_CATALOG>;
    };
    const selection = selectExperts(
      body.userRequest ?? "",
      body.experts,
    );
    return {
      selection,
      systemBlock: buildExpertSystemBlock(selection),
    };
  });

  /** Consult a specific expert category → structured findings (like QA). */
  app.post("/api/v1/experts/review", async (request, reply) => {
    osStore.ensureLoaded();
    const body = createExpertReviewSchema.parse(request.body);
    // SECURITY FIX (closing the actorId/Risk-Engine gap — see
    // atlas-master-checklist.md batch 9): this route previously only
    // required auth when a projectId was given, and never ran an
    // entity-policy / risk / audit gate at all, so a persisted
    // ExpertReview record could exist with no real actorId anywhere in its
    // trail. Now always requires sign-in and is gated the same way as the
    // other "run something → persist a RECORD" routes (qa.runs.create,
    // benchmarks.run) — `RECORD.EXECUTE` fits "run an expert review and
    // persist its findings" better than CREATE, matching that precedent.
    const user = body.projectId
      ? await assertProjectReadAccess(app, request, body.projectId)
      : await requireUser(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "experts.review",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
    const project = body.projectId ? osStore.getProject(body.projectId) : undefined;
    const review = runExpertReview(body, {
      projectName: project?.name ?? null,
    });

    osStore.recordEvent({
      type: "expert.review.created",
      reviewId: review.id,
      expertId: review.expertId,
      projectId: review.projectId,
      at: review.createdAt,
    });

    return reply.status(201).send(review);
  });

  /** Cursor / Claude / VS Code brief — ArletOS does not embed an IDE */
  app.post("/api/v1/editor/brief", async (request, reply) => {
    osStore.ensureLoaded();
    const body = createEditorBriefSchema.parse(request.body);
    // SECURITY FIX: same class of gap as /experts/review above — this route
    // can embed a project's decisions/snapshot into the generated brief,
    // and previously never ran an entity-policy / risk / audit gate at all.
    // Now always requires sign-in; `RECORD.CREATE` fits "persist a new
    // EditorBrief document from caller-supplied inputs" (mirrors
    // audit-engine.contract.put's CONFIGURATION.CREATE reasoning for a
    // similar "always persists a full new document" shape).
    const user = body.projectId
      ? await assertProjectReadAccess(app, request, body.projectId)
      : await requireUser(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "editor.brief.create",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
    const now = new Date().toISOString();
    const selection = selectExperts(
      body.userRequest,
      body.experts,
    );
    const project = body.projectId
      ? osStore.getProject(body.projectId)
      : undefined;
    const snapshot =
      body.includeState && body.projectId
        ? osStore.getSnapshot(body.projectId)
        : undefined;
    const decisions =
      body.includeDecisions && body.projectId
        ? osStore.getDecisions(body.projectId)
        : [];

    const md: string[] = [
      `# ArletOS → Editor Brief`,
      ``,
      `> Paste this into any editor or coding agent (Cursor, Claude, VS Code, Vercel, …).`,
      `> ArletOS is Engineering+QA intelligence — not a Visual Studio clone.`,
      ``,
      `## Request`,
      body.userRequest,
      ``,
      `## Experts`,
      `- Primary: ${selection.primary}`,
      `- Supporting: ${selection.supporting.join(", ") || "none"}`,
      `- ${selection.rationale}`,
      ``,
    ];

    if (project) {
      md.push(`## Project`, `- ${project.name} (\`${project.slug}\`)`, ``);
    }

    if (snapshot) {
      md.push(
        `## Current state (epistemic: ${snapshot.overallEpistemicState})`,
        `- Reconciled: ${snapshot.reconciledAt ?? "unknown"}`,
        `- Conflicts: ${snapshot.conflicts.length}`,
        ``,
      );
    }

    if (decisions.length > 0) {
      md.push(`## Active decisions`);
      for (const d of decisions.slice(-5)) {
        md.push(`- [${d.epistemicState}] ${d.decision}`);
      }
      md.push(``);
    }

    if (body.includeQaHints) {
      md.push(
        `## QA hints`,
        `- Prefer risk-based tests (auth/payments/migrations = CRITICAL/HIGH)`,
        `- After fix: retest + regression rule`,
        `- WRITE stays locked until human APPROVE`,
        ``,
      );
    }

    md.push(
      `## Expert checklists`,
      ...[selection.primary, ...selection.supporting].flatMap((id) => {
        const def = EXPERT_CATALOG[id];
        return [`### ${def.titleEn}`, ...def.checklist.map((c) => `- [ ] ${c}`), ``];
      }),
    );

    const brief = editorBriefSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId ?? null,
      title: `Brief: ${body.userRequest.slice(0, 80)}`,
      markdown: md.join("\n"),
      experts: [selection.primary, ...selection.supporting],
      createdAt: now,
      editorHint:
        "Paste into your editor or coding agent. ArletOS provides the brief — coding stays in your tools.",
    });

    osStore.recordEvent({
      type: "editor.brief.created",
      briefId: brief.id,
      experts: brief.experts,
      at: now,
    });

    return reply.status(201).send(brief);
  });
}
