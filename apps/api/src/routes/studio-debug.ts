/**
 * Debugger routes — Studio Evolution design (2026-10-04 Design Plan,
 * approved for implementation).
 *
 * ISOLATION (locked): no import of governed-command.ts or studio-execution.ts.
 * Debug targets come only from studio-debug-spawn.ts's own catalog.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema, type AuthUser } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import { getProjectOwnerId } from "../services/project-access.js";
import { requireUser } from "../middleware/auth-guards.js";
import {
  denyAgentDebugRequest,
  evaluateDebugGate,
  isAgentDebugRequest,
  isAtlasApiElevated,
  isDebuggerEnabledOnHost,
  readProjectEnvironmentTier,
  type DebugGateDenial,
} from "../services/studio-debug-gate.js";
import { listDebugTargets } from "../services/studio-debug-spawn.js";
import {
  closeDebugSessionVoluntary,
  createDebugSession,
  forceCloseDebugSession,
  getDebugSession,
  hasActiveDebugSessionForTarget,
  performDebugAction,
  revokeDebugSessionAuthorization,
} from "../services/studio-debug-session.js";

const targetIdSchema = z.string().min(1).max(120);
const actionSchema = z.enum(["continue", "pause", "step", "breakpoint.add", "breakpoint.remove", "inspect"]);

function headerMap(request: FastifyRequest): Record<string, unknown> {
  return request.headers as Record<string, unknown>;
}

/**
 * Project write-access for a request that targets an existing session.
 * If the caller IS the session's opener and access has been lost (403) or
 * the project is gone (404), the session is revoked and its process killed
 * BEFORE the error is rethrown — the current action is blocked and no
 * further action is possible (approved S1 fail-safe). A caller who is not
 * the opener, or who is not signed in (401, so no identity to attribute),
 * can never revoke someone else's session by probing it.
 */
async function authorizeSessionRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  projectId: string,
  sessionId: string,
): Promise<AuthUser> {
  const actor = await requireUser(app, request);
  try {
    return await assertProjectWriteAccess(app, request, projectId);
  } catch (error) {
    if (error instanceof AtlasError && (error.statusCode === 403 || error.statusCode === 404)) {
      const session = getDebugSession(sessionId);
      if (
        session &&
        session.projectId === projectId &&
        session.openerId === actor.id &&
        session.status === "ACTIVE"
      ) {
        revokeDebugSessionAuthorization(sessionId, `project access lost (${error.statusCode})`);
      }
    }
    throw error;
  }
}

function linkedWorkspace(projectId: string): string {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot on the project before opening a debug session.",
      { statusCode: 400 },
    );
  }
  return stored;
}

function denialStatusCode(denial: DebugGateDenial | string): number {
  return denial === "P3_CONFIGURATION_ERROR" ? 503 : 403;
}

export async function registerStudioDebugRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/projects/:id/studio/debug/targets", async (request) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    return { targets: listDebugTargets() };
  });

  app.post("/api/v1/projects/:id/studio/debug/sessions", async (request, reply) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({ targetId: targetIdSchema, relativePath: z.string().min(1).max(500).optional() })
      .strict()
      .parse(request.body ?? {});

    const decision = evaluateDebugGate({
      hostEnabled: isDebuggerEnabledOnHost(),
      elevated: isAtlasApiElevated(),
      environmentTier: readProjectEnvironmentTier(projectId),
      ownerId: getProjectOwnerId(projectId),
      actorId: user.id,
      hasActiveSessionForTarget: hasActiveDebugSessionForTarget(projectId, body.targetId),
    });
    if (decision.decision === "DENY") {
      osStore.appendAudit({
        type: "debugger.request.denied",
        projectId,
        actorId: user.id,
        targetId: body.targetId,
        denial: decision.denial,
        at: new Date().toISOString(),
      });
      return reply
        .status(denialStatusCode(decision.denial))
        .send({ error: { code: decision.denial, message: decision.reason } });
    }

    const created = createDebugSession({
      projectId,
      openerId: user.id,
      targetId: body.targetId,
      workspaceRoot: linkedWorkspace(projectId),
      ...(body.relativePath ? { relativePath: body.relativePath } : {}),
    });
    if (!created.ok) {
      osStore.appendAudit({
        type: "debugger.request.denied",
        projectId,
        actorId: user.id,
        targetId: body.targetId,
        denial: created.denial,
        at: new Date().toISOString(),
      });
      return reply.status(400).send({ error: { code: created.denial, message: created.reason } });
    }
    return reply.status(201).send({ session: created.session, ticket: created.ticket });
  });

  app.get("/api/v1/projects/:id/studio/debug/sessions/:sessionId", async (request) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    await authorizeSessionRequest(app, request, projectId, sessionId);
    const session = getDebugSession(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new AtlasError("NOT_FOUND", "Debug session not found.", { statusCode: 404 });
    }
    return { session };
  });

  app.post("/api/v1/projects/:id/studio/debug/sessions/:sessionId/action", async (request, reply) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    const user = await authorizeSessionRequest(app, request, projectId, sessionId);
    const body = z.object({ action: actionSchema }).strict().parse(request.body ?? {});
    const result = performDebugAction({ sessionId, actorId: user.id, action: body.action });
    if (!result.ok) {
      return reply.status(403).send({ error: { code: result.denial, message: result.reason } });
    }
    return reply.send({ ok: true });
  });

  app.post("/api/v1/projects/:id/studio/debug/sessions/:sessionId/close", async (request, reply) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    const user = await authorizeSessionRequest(app, request, projectId, sessionId);
    const result = closeDebugSessionVoluntary(sessionId, user.id);
    if (!result.ok) {
      return reply.status(403).send({ error: { code: result.denial, message: result.reason } });
    }
    return reply.send({ ok: true });
  });

  app.post("/api/v1/projects/:id/studio/debug/sessions/:sessionId/force-close", async (request, reply) => {
    if (isAgentDebugRequest(headerMap(request))) denyAgentDebugRequest();
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    const user = await requireUser(app, request);
    const body = z.object({ reason: z.string().min(1).max(2000) }).strict().parse(request.body ?? {});
    const result = forceCloseDebugSession({
      sessionId,
      actorId: user.id,
      actorRole: user.role,
      reason: body.reason,
    });
    if (!result.ok) {
      return reply.status(403).send({ error: { code: result.denial, message: result.reason } });
    }
    return reply.send({ ok: true });
  });
}
