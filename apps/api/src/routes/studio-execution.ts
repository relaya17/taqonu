/**
 * Governed Studio Terminal / Test Runner / Extensions.
 *
 * RECORD.EXECUTE is HIGH_RISK_WRITE + requiresApproval and lands at HUMAN_ONLY
 * with conservative default confidence/evidence — same live-human
 * decide-and-execute split as Sentinel CASE.EXECUTE. Callers send a catalog
 * commandId. Spawn is shell:false inside the linked project workspaceRoot.
 * No client argv. No unrestricted shell. Extensions are manifest-only.
 */
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import {
  runGovernedClaimedExecution,
  type HelperResult,
} from "../services/governed-claimed-execution.js";
import { runLiveHumanDecisionExecution } from "../services/live-human-execution.js";
import {
  getGovernedCommand,
  killGovernedExecution,
  listGovernedCommands,
  runGovernedCommand,
  type GovernedCommandKind,
  type GovernedCommandResult,
} from "../services/governed-command.js";
import {
  listStudioExtensions,
  setStudioExtensionEnabled,
  STUDIO_EXTENSION_CONTRACT,
} from "../services/studio-extensions.js";
import { osStore } from "../store/os-store.js";

const commandIdSchema = z.enum([
  "node.version",
  "git.status",
  "git.branch",
  "git.diff",
  "git.log",
  "git.blame",
  "git.add",
  "git.unstage",
  "git.restore",
  "workspace.build",
  "vitest.run",
]);

type LastExecution = {
  readonly projectId: string;
  readonly at: string;
  readonly kind: GovernedCommandKind;
  readonly result: GovernedCommandResult;
};

const lastByProject = new Map<string, LastExecution>();

const LAST_META_PREFIX = "studio.execution.last.";

export function resetStudioExecutionForTests(): void {
  lastByProject.clear();
}

function persistLast(record: LastExecution): void {
  lastByProject.set(record.projectId, record);
  osStore.setMeta(
    `${LAST_META_PREFIX}${record.projectId}`,
    JSON.stringify(record),
  );
}

function loadLast(projectId: string): LastExecution | undefined {
  const cached = lastByProject.get(projectId);
  if (cached) return cached;
  const raw = osStore.getMeta(`${LAST_META_PREFIX}${projectId}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as LastExecution;
    if (parsed?.projectId === projectId && parsed.result) {
      lastByProject.set(projectId, parsed);
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function approvalRequiredBody(
  approvalRequestId: string,
  commandId: string,
  executionId: string,
) {
  return {
    status: "APPROVAL_REQUIRED" as const,
    approvalId: approvalRequestId,
    approvalRequestId,
    commandId,
    executionId,
    reason: "RECORD.EXECUTE requires a live second-identity decision",
    message:
      "A second, live-authenticated identity with write access to this " +
      "project (never the requester) must submit POST " +
      `.../decide-and-execute with { "approvalId": "${approvalRequestId}", ` +
      `"decisionReason": "...", "commandId": "${commandId}" }.`,
  };
}

function throwHelperFailure(helper: HelperResult<unknown>): never {
  const reason = "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(reason)) {
    throw new AtlasError("NOT_FOUND", reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

function commandArtifactHash(projectId: string, commandId: string): string {
  return createHash("sha256")
    .update(`studio-exec:${projectId}:${commandId}`)
    .digest("hex");
}

function linkedWorkspace(projectId: string): string {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot on the project before running Studio commands.",
    );
  }
  return resolve(stored);
}

function remember(projectId: string, kind: GovernedCommandKind, result: GovernedCommandResult) {
  persistLast({
    projectId,
    at: new Date().toISOString(),
    kind,
    result,
  });
}

function auditExecution(
  type: string,
  projectId: string,
  userId: string,
  payload: Record<string, unknown>,
): void {
  osStore.appendAudit({
    type,
    projectId,
    actorId: userId,
    at: new Date().toISOString(),
    ...payload,
  });
}

function mapResult(result: GovernedCommandResult) {
  if (!result.ok) {
    return {
      status: result.denial === "UNAVAILABLE" ? ("UNAVAILABLE" as const) : ("DENIED" as const),
      executionId: result.executionId,
      commandId: result.commandId,
      kind: result.kind,
      denial: result.denial,
      reason: result.reason,
      passed: false as const,
    };
  }
  const passed = result.kind === "test" ? result.exitCode === 0 && !result.timedOut : null;
  return {
    status: result.timedOut
      ? ("TIMED_OUT" as const)
      : result.killed
        ? ("KILLED" as const)
        : result.exitCode === 0
          ? ("EXITED" as const)
          : ("FAILED" as const),
    executionId: result.executionId,
    commandId: result.commandId,
    kind: result.kind,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    truncated: result.truncated,
    timedOut: result.timedOut,
    killed: result.killed,
    passed,
    note:
      result.kind === "test"
        ? "pass is exitCode===0 of the workspace-local Vitest. Missing binary is UNAVAILABLE, not PASS."
        : "Output is captured evidence. It is not Truth.",
  };
}

export async function registerStudioExecutionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/projects/:id/studio/commands", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    return {
      commands: listGovernedCommands(),
      contract: {
        unrestrictedShell: false,
        clientArgvAccepted: false,
        spawnShell: false,
        approval: "RECORD.EXECUTE live-human decide-and-execute",
      },
    };
  });

  async function postRun(
    kind: GovernedCommandKind,
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        commandId: commandIdSchema,
        relativePath: z.string().min(1).max(500).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const spec = getGovernedCommand(body.commandId);
    if (!spec || spec.kind !== kind) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `Command "${body.commandId}" is not a ${kind} allowlist entry.`,
      );
    }
    linkedWorkspace(projectId);
    const executionId = randomUUID();

    const helper = await runGovernedClaimedExecution<ReturnType<typeof mapResult>>({
      executorId: user.id,
      actor: { kind: "AGENT", agentId: user.id, onBehalfOfUserId: user.id },
      entityType: "RECORD",
      action: "EXECUTE",
      artifactHash: commandArtifactHash(projectId, body.commandId),
      requestId: request.id,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId,
      routeLabel: `studio.${kind}.request`,
      dispatchInput: { commandId: body.commandId, kind, executionId },
      executeOnce: async () => {
        const result = await runGovernedCommand({
          commandId: body.commandId,
          workspaceRoot: linkedWorkspace(projectId),
          projectId,
          executionId,
          ...(body.relativePath ? { relativePath: body.relativePath } : {}),
        });
        remember(projectId, kind, result);
        auditExecution(`studio.${kind}.executed`, projectId, user.id, {
          commandId: body.commandId,
          executionId,
          ok: result.ok,
          denial: result.ok ? null : result.denial,
          exitCode: result.ok ? result.exitCode : null,
        });
        return {
          kind: "SUCCESS",
          value: mapResult(result),
          outputEvidence: JSON.stringify({
            commandId: body.commandId,
            executionId,
            ok: result.ok,
          }),
        };
      },
    });

    if (helper.status === "APPROVAL_REQUIRED") {
      auditExecution(`studio.${kind}.approval_required`, projectId, user.id, {
        commandId: body.commandId,
        approvalRequestId: helper.approvalRequestId,
        executionId,
      });
      return reply
        .status(202)
        .send(approvalRequiredBody(helper.approvalRequestId, body.commandId, executionId));
    }
    if (helper.status === "EXECUTED" && helper.gate !== undefined) {
      return reply.send(helper.value);
    }
    throwHelperFailure(helper);
  }

  async function decideAndExecute(
    kind: GovernedCommandKind,
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        approvalId: z.string().uuid(),
        decisionReason: z.string().min(1).max(2000),
        commandId: commandIdSchema,
        executionId: z.string().uuid().optional(),
        relativePath: z.string().min(1).max(500).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const spec = getGovernedCommand(body.commandId);
    if (!spec || spec.kind !== kind) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `Command "${body.commandId}" is not a ${kind} allowlist entry.`,
      );
    }
    const executionId = body.executionId ?? randomUUID();

    const helper = await runLiveHumanDecisionExecution<ReturnType<typeof mapResult>>({
      approvalId: body.approvalId,
      deciderId: user.id,
      decisionReason: body.decisionReason,
      entityType: "RECORD",
      action: "EXECUTE",
      artifactHash: commandArtifactHash(projectId, body.commandId),
      requestId: request.id,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId,
      routeLabel: `studio.${kind}.live-human`,
      dispatchInput: { commandId: body.commandId, kind, executionId },
      executeOnce: async () => {
        const result = await runGovernedCommand({
          commandId: body.commandId,
          workspaceRoot: linkedWorkspace(projectId),
          projectId,
          executionId,
          ...(body.relativePath ? { relativePath: body.relativePath } : {}),
        });
        remember(projectId, kind, result);
        auditExecution(`studio.${kind}.executed`, projectId, user.id, {
          commandId: body.commandId,
          executionId,
          ok: result.ok,
          denial: result.ok ? null : result.denial,
          exitCode: result.ok ? result.exitCode : null,
          approvalId: body.approvalId,
        });
        return {
          kind: "SUCCESS",
          value: mapResult(result),
          outputEvidence: JSON.stringify({
            commandId: body.commandId,
            executionId,
            ok: result.ok,
            approvalId: body.approvalId,
          }),
        };
      },
    });

    if (helper.status === "EXECUTED") {
      if (helper.gate === undefined) {
        throw new AtlasError(
          "FORBIDDEN",
          helper.approval
            ? `Approval request ${helper.approval.id} is already finalized`
            : "approval already finalized",
          { statusCode: 403 },
        );
      }
      return reply.send(helper.value);
    }
    throwHelperFailure(helper);
  }

  app.post("/api/v1/projects/:id/studio/terminal", async (request, reply) =>
    postRun("terminal", request, reply),
  );
  app.post(
    "/api/v1/projects/:id/studio/terminal/decide-and-execute",
    async (request, reply) => decideAndExecute("terminal", request, reply),
  );
  app.post("/api/v1/projects/:id/studio/tests", async (request, reply) =>
    postRun("test", request, reply),
  );
  app.post("/api/v1/projects/:id/studio/tests/decide-and-execute", async (request, reply) =>
    decideAndExecute("test", request, reply),
  );
  app.post("/api/v1/projects/:id/studio/build", async (request, reply) =>
    postRun("build", request, reply),
  );
  app.post(
    "/api/v1/projects/:id/studio/build/decide-and-execute",
    async (request, reply) => decideAndExecute("build", request, reply),
  );

  app.get("/api/v1/projects/:id/studio/executions/last", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const last = loadLast(projectId);
    if (!last) {
      return { status: "NOT_RUN" as const, projectId, result: null };
    }
    return {
      status: "OBSERVED" as const,
      projectId,
      at: last.at,
      kind: last.kind,
      result: mapResult(last.result),
    };
  });

  app.post("/api/v1/projects/:id/studio/execution/kill", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({ executionId: z.string().uuid() })
      .strict()
      .parse(request.body ?? {});
    const outcome = killGovernedExecution(body.executionId);
    auditExecution("studio.execution.kill", projectId, user.id, {
      executionId: body.executionId,
      outcome,
    });
    if (outcome === "not_running") {
      throw new AtlasError(
        "CONFLICT",
        "No in-flight governed execution with that id. Fail closed — nothing was killed.",
        { statusCode: 409 },
      );
    }
    return reply.send({ status: "KILLED" as const, executionId: body.executionId });
  });

  app.get("/api/v1/projects/:id/studio/extensions", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    return {
      contract: STUDIO_EXTENSION_CONTRACT,
      extensions: listStudioExtensions(projectId),
      note: "Manifest registry only. No marketplace. No user JavaScript. hostReady is always false.",
    };
  });

  app.post("/api/v1/projects/:id/studio/extensions/:extensionId/enable", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const extensionId = z
      .string()
      .min(1)
      .max(80)
      .parse((request.params as { extensionId: string }).extensionId);
    const result = setStudioExtensionEnabled(projectId, extensionId, true);
    if (!result.ok) {
      throw new AtlasError("NOT_FOUND", `Unknown extension "${extensionId}"`, {
        statusCode: 404,
      });
    }
    auditExecution("studio.extension.enabled", projectId, user.id, {
      extensionId,
      hostReady: false,
    });
    return {
      ...result,
      note: "Listed as enabled in this API process. No host API runs. Not durable Atlas SoR.",
    };
  });

  app.post("/api/v1/projects/:id/studio/extensions/:extensionId/disable", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const extensionId = z
      .string()
      .min(1)
      .max(80)
      .parse((request.params as { extensionId: string }).extensionId);
    const result = setStudioExtensionEnabled(projectId, extensionId, false);
    if (!result.ok) {
      throw new AtlasError("NOT_FOUND", `Unknown extension "${extensionId}"`, {
        statusCode: 404,
      });
    }
    auditExecution("studio.extension.disabled", projectId, user.id, { extensionId });
    return result;
  });
}
