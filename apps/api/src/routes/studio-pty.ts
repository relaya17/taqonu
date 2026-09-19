/**
 * Human-only interactive Studio PTY.
 *
 * Separate from governed `commandId` execution in studio-execution.ts.
 * The Agent has no route here. Transcripts are never audited.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { isAllowedWebOrigin } from "../lib/web-origin.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import { osStore } from "../store/os-store.js";
import {
  assertPtyTicket,
  closeStudioPty,
  createStudioPtySession,
  denyAgentPty,
  eofStudioPty,
  getStudioPtySession,
  interruptStudioPty,
  isAgentPtyRequest,
  listStudioPtySessions,
  reconnectStudioPty,
  resizeStudioPty,
  studioPtyLimits,
  subscribeStudioPtyByTicket,
  writeStudioPty,
} from "../services/studio-pty.js";

const shellSchema = z.enum(["powershell", "cmd"]);

const createBodySchema = z
  .object({
    shell: shellSchema.optional(),
    cols: z.number().int().min(20).max(400).optional(),
    rows: z.number().int().min(8).max(120).optional(),
  })
  .strict();

const resizeBodySchema = z
  .object({
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(8).max(120),
  })
  .strict();

const inputBodySchema = z
  .object({
    data: z.string().min(1).max(32_768),
  })
  .strict();

function linkedWorkspace(projectId: string): string {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot on the project before opening a terminal.",
    );
  }
  return stored;
}

function headerMap(request: FastifyRequest): Record<string, unknown> {
  return request.headers as Record<string, unknown>;
}

function assertSessionProject(sessionId: string, projectId: string): void {
  const existing = getStudioPtySession(sessionId);
  if (!existing) {
    throw new AtlasError("NOT_FOUND", "Terminal session is not running.", { statusCode: 404 });
  }
  if (existing.snapshot.projectId !== projectId) {
    throw new AtlasError("FORBIDDEN", "Terminal session belongs to another project.", {
      statusCode: 403,
    });
  }
}

function auditPty(
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

export async function registerStudioPtyRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/api/v1/projects/:id/studio/pty", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    return {
      surface: "user-terminal" as const,
      agentAccess: false as const,
      persistTranscript: false as const,
      governedCommandPath: "/api/v1/projects/:id/studio/terminal",
      shells: ["powershell", "cmd"] as const,
      defaultShell: process.platform === "win32" ? ("powershell" as const) : ("powershell" as const),
      limits: studioPtyLimits(),
      sessions: listStudioPtySessions(projectId, user.id),
    };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = createBodySchema.parse(request.body ?? {});
    const created = createStudioPtySession({
      projectId,
      ownerId: user.id,
      workspaceRoot: linkedWorkspace(projectId),
      ...(body.shell ? { shell: body.shell } : {}),
      ...(body.cols !== undefined ? { cols: body.cols } : {}),
      ...(body.rows !== undefined ? { rows: body.rows } : {}),
    });
    auditPty("studio.pty.opened", projectId, user.id, {
      sessionId: created.snapshot.sessionId,
      pid: created.snapshot.pid,
      cwd: created.snapshot.cwd,
      shell: created.snapshot.shell,
    });
    return {
      session: created.snapshot,
      ticket: created.ticket,
      streamPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${created.snapshot.sessionId}/stream`,
      eventsPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${created.snapshot.sessionId}/events`,
    };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/reconnect", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    const reconnected = reconnectStudioPty({
      sessionId,
      ownerId: user.id,
      projectId,
    });
    auditPty("studio.pty.reconnected", projectId, user.id, {
      sessionId,
      pid: reconnected.snapshot.pid,
    });
    return {
      session: reconnected.snapshot,
      ticket: reconnected.ticket,
      streamPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${sessionId}/stream`,
      eventsPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${sessionId}/events`,
    };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/input", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    assertSessionProject(sessionId, projectId);
    const body = inputBodySchema.parse(request.body ?? {});
    writeStudioPty(sessionId, user.id, body.data);
    return { ok: true as const };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/interrupt", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    assertSessionProject(sessionId, projectId);
    interruptStudioPty(sessionId, user.id);
    return { ok: true as const };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/eof", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    assertSessionProject(sessionId, projectId);
    eofStudioPty(sessionId, user.id);
    return { ok: true as const };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/resize", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    assertSessionProject(sessionId, projectId);
    const body = resizeBodySchema.parse(request.body ?? {});
    return { session: resizeStudioPty(sessionId, user.id, body.cols, body.rows) };
  });

  app.post("/api/v1/projects/:id/studio/pty/sessions/:sessionId/close", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const sessionId = uuidSchema.parse((request.params as { sessionId: string }).sessionId);
    if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
    const user = await assertProjectWriteAccess(app, request, projectId);
    assertSessionProject(sessionId, projectId);
    const session = closeStudioPty(sessionId, user.id);
    auditPty("studio.pty.closed", projectId, user.id, {
      sessionId,
      pid: session.pid,
      exitCode: session.exitCode,
    });
    return { session };
  });

  app.get(
    "/api/v1/projects/:id/studio/pty/sessions/:sessionId/events",
    async (request, reply) => {
      const projectId = uuidSchema.parse((request.params as { id: string }).id);
      const sessionId = uuidSchema.parse(
        (request.params as { sessionId: string }).sessionId,
      );
      if (isAgentPtyRequest(headerMap(request))) denyAgentPty();
      const url = new URL(request.url, "http://studio.local");
      const ticket = url.searchParams.get("ticket") ?? "";
      const existing = getStudioPtySession(sessionId);
      if (!existing) {
        throw new AtlasError("NOT_FOUND", "Terminal session is not running.", { statusCode: 404 });
      }
      assertPtyTicket(existing, ticket);
      if (existing.snapshot.projectId !== projectId) {
        throw new AtlasError("FORBIDDEN", "Terminal session belongs to another project.", {
          statusCode: 403,
        });
      }

      const headers: Record<string, string> = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      };
      const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
      const webOrigin = app.atlasEnv?.WEB_ORIGIN ?? "http://localhost:3000";
      if (origin && isAllowedWebOrigin(origin, webOrigin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
        headers.Vary = "Origin";
      }
      reply.hijack();
      request.raw.setTimeout(0);
      reply.raw.writeHead(200, headers);
      const sub = subscribeStudioPtyByTicket(sessionId, ticket, {
        onData: (data) => {
          writeSse(reply.raw, { type: "data", data });
        },
        onExit: (event) => {
          writeSse(reply.raw, {
            type: "exit",
            exitCode: event.exitCode,
            signal: event.signal ?? null,
          });
          if (!reply.raw.writableEnded) reply.raw.end();
        },
      });
      writeSse(reply.raw, { type: "ready", session: sub.snapshot });
      if (sub.scrollback) {
        writeSse(reply.raw, { type: "data", data: sub.scrollback });
      }
      const ping = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(":ping\n\n");
      }, 15_000);
      const cleanup = (): void => {
        clearInterval(ping);
        sub.unsubscribe();
      };
      request.raw.on("close", cleanup);
      reply.raw.on("close", cleanup);
    },
  );

  app.get(
    "/api/v1/projects/:id/studio/pty/sessions/:sessionId/stream",
    { websocket: true },
    (socket, request) => {
      void (async () => {
        try {
          const projectId = uuidSchema.parse((request.params as { id: string }).id);
          const sessionId = uuidSchema.parse(
            (request.params as { sessionId: string }).sessionId,
          );
          if (isAgentPtyRequest(headerMap(request))) {
            socket.close(4403, "agent-denied");
            return;
          }
          const url = new URL(request.url, "http://studio.local");
          const ticket = url.searchParams.get("ticket") ?? "";
          const sub = subscribeStudioPtyByTicket(sessionId, ticket, {
            onData: (data) => {
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify({ type: "data", data }));
              }
            },
            onExit: (event) => {
              if (socket.readyState === socket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: "exit",
                    exitCode: event.exitCode,
                    signal: event.signal ?? null,
                  }),
                );
                socket.close(1000, "exited");
              }
            },
          });
          if (sub.snapshot.projectId !== projectId) {
            sub.unsubscribe();
            socket.close(4403, "project-mismatch");
            return;
          }
          const ownerId = sub.ownerId;
          socket.send(
            JSON.stringify({
              type: "ready",
              session: sub.snapshot,
            }),
          );
          if (sub.scrollback) {
            socket.send(JSON.stringify({ type: "data", data: sub.scrollback }));
          }
          socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
            try {
              const text = typeof raw === "string" ? raw : Buffer.from(raw as Buffer).toString("utf8");
              const msg = JSON.parse(text) as {
                type?: string;
                data?: string;
                cols?: number;
                rows?: number;
              };
              if (msg.type === "input" && typeof msg.data === "string") {
                writeStudioPty(sessionId, ownerId, msg.data);
                return;
              }
              if (msg.type === "interrupt") {
                interruptStudioPty(sessionId, ownerId);
                return;
              }
              if (msg.type === "eof") {
                eofStudioPty(sessionId, ownerId);
                return;
              }
              if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
                resizeStudioPty(sessionId, ownerId, msg.cols, msg.rows);
              }
            } catch (error) {
              if (socket.readyState === socket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    message: error instanceof Error ? error.message : "terminal input failed",
                  }),
                );
              }
            }
          });
          socket.on("close", () => {
            sub.unsubscribe();
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "terminal stream failed";
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "error", message }));
            socket.close(1011, "error");
          }
        }
      })();
    },
  );
}

function writeSse(stream: { writableEnded?: boolean; write: (chunk: string) => unknown }, payload: unknown): void {
  if (stream.writableEnded) return;
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}
