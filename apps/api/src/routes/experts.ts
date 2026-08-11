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

export async function registerExpertRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/experts", async () => ({
    items: listExperts().map((expert) => ({
      id: expert.id,
      titleHe: expert.titleHe,
      titleEn: expert.titleEn,
      titleAr: expert.titleAr,
      focus: expert.focus,
      checklist: expert.checklist,
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
      `> Paste this into **Cursor / Claude Code / VS Code**.`,
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
