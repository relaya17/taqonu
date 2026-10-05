/**
 * Debugger CDP transport — first vertical slice.
 *
 * This is the debug TRANSPORT only. It is not an authorization mechanism: it
 * never decides who may act. Atlas user authorization, Debug Session
 * authorization, execution isolation and lifecycle control all live outside
 * this module (studio-debug-session.ts and the routes). It only speaks to the
 * V8 Inspector of a target that the session module already owns.
 *
 * Boundary rules:
 * - The Inspector URL (it carries the endpoint path) is discovered from the
 *   target's own announcement and used only inside this process. It is never
 *   returned, logged, audited or put in an error message, and Studio never
 *   needs it.
 * - Only a loopback `ws://127.0.0.1:<port>/<id>` announcement is accepted.
 * - Runtime values (evaluation input and output) are returned to the caller
 *   but are bounded here and must not be audited by callers.
 *
 * Known boundary (D1, not addressed here): the raw Inspector endpoint is still
 * reachable by other local processes. See the approved D1 classification.
 */
import { WebSocket, type RawData } from "ws";

/** Time allowed for the target to announce its Inspector endpoint. */
export const CDP_ANNOUNCE_TIMEOUT_MS = 10_000;
/** Time allowed for the WebSocket handshake and for each Inspector command. */
export const CDP_COMMAND_TIMEOUT_MS = 10_000;
export const CDP_MAX_EXPRESSION_CHARS = 4096;

const CDP_MAX_MESSAGE_BYTES = 1024 * 1024;
const CDP_MAX_RESULT_TEXT_CHARS = 2000;
const ANNOUNCE_POLL_MS = 25;

const ANNOUNCEMENT = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-fA-F-]{8,})/;

/** Returns the loopback Inspector URL announced on the target's stderr, or null. */
export function parseInspectorAnnouncement(stderr: string): string | null {
  return ANNOUNCEMENT.exec(stderr)?.[1] ?? null;
}

export type InspectorErrorCategory =
  | "ANNOUNCE_TIMEOUT"
  | "CONNECT_FAILED"
  | "COMMAND_TIMEOUT"
  | "COMMAND_ERROR"
  | "CLOSED";

/** Messages are fixed strings: they never contain the Inspector URL or runtime data. */
export class InspectorError extends Error {
  constructor(
    readonly category: InspectorErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = "InspectorError";
  }
}

export interface InspectorConnection {
  isPaused(): boolean;
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  waitForPaused(timeoutMs?: number): Promise<void>;
  /** Idempotent. Closes the socket immediately and does NOT invoke `onClosed`. */
  close(): void;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: InspectorError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForAnnouncement(readStderr: () => string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = parseInspectorAnnouncement(readStderr());
    if (url) return url;
    if (Date.now() >= deadline) {
      throw new InspectorError("ANNOUNCE_TIMEOUT", "The debug target did not announce its Inspector endpoint in time.");
    }
    await sleep(ANNOUNCE_POLL_MS);
  }
}

function openSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      handshakeTimeout: timeoutMs,
      maxPayload: CDP_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    const fail = () => {
      socket.terminate();
      reject(new InspectorError("CONNECT_FAILED", "Could not connect to the debug target's Inspector."));
    };
    socket.once("open", () => {
      socket.off("error", fail);
      resolve(socket);
    });
    socket.once("error", fail);
  });
}

/**
 * Connects to the target's Inspector. `onClosed` fires only when the
 * connection is lost; closing it through `close()` does not fire it.
 * `onTargetFinished` fires when Node reports it is waiting for the debugger to
 * disconnect, so the owner can end the session instead of leaving the process hanging.
 */
export async function connectInspector(input: {
  readonly readStderr: () => string;
  readonly onClosed: () => void;
  /** The target has finished running and Node is waiting for this controller to disconnect. */
  readonly onTargetFinished: () => void;
}): Promise<InspectorConnection> {
  const url = await waitForAnnouncement(input.readStderr, CDP_ANNOUNCE_TIMEOUT_MS);
  const socket = await openSocket(url, CDP_COMMAND_TIMEOUT_MS);

  let nextId = 1;
  let paused = false;
  let closedByUs = false;
  let lost = false;
  const pending = new Map<number, Pending>();
  const pausedWaiters = new Set<() => void>();

  const rejectAll = () => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new InspectorError("CLOSED", "The Inspector connection is closed."));
      pending.delete(id);
    }
  };

  socket.on("message", (data: RawData) => {
    let message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(data.toString()) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new InspectorError("COMMAND_ERROR", "The Inspector rejected the command."));
      } else {
        // The accepted resume is authoritative; the `Debugger.resumed` event can trail the reply.
        if (entry.method === "Debugger.resume") paused = false;
        entry.resolve((message.result ?? {}) as Record<string, unknown>);
      }
      return;
    }
    if (message.method === "Debugger.paused") {
      paused = true;
      for (const wake of [...pausedWaiters]) wake();
    } else if (message.method === "Debugger.resumed") {
      paused = false;
    } else if (message.method === "NodeRuntime.waitingForDisconnect") {
      // Node holds a finishing process open until the debugger disconnects.
      input.onTargetFinished();
    }
  });

  socket.on("close", () => {
    rejectAll();
    for (const wake of [...pausedWaiters]) wake();
    if (closedByUs || lost) return;
    lost = true;
    input.onClosed();
  });
  // A socket error is always followed by 'close'; this only keeps it from being unhandled.
  socket.on("error", () => undefined);

  return {
    isPaused: () => paused,
    send(method, params) {
      if (closedByUs || lost || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new InspectorError("CLOSED", "The Inspector connection is closed."));
      }
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new InspectorError("COMMAND_TIMEOUT", "The Inspector command timed out."));
        }, CDP_COMMAND_TIMEOUT_MS);
        pending.set(id, { method, resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }), (error) => {
          if (!error) return;
          const entry = pending.get(id);
          if (!entry) return;
          pending.delete(id);
          clearTimeout(entry.timer);
          reject(new InspectorError("CLOSED", "The Inspector connection is closed."));
        });
      });
    },
    waitForPaused(timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
      if (paused) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const wake = () => {
          clearTimeout(timer);
          pausedWaiters.delete(wake);
          if (paused) resolve();
          else reject(new InspectorError("CLOSED", "The Inspector connection is closed."));
        };
        const timer = setTimeout(() => {
          pausedWaiters.delete(wake);
          reject(new InspectorError("COMMAND_TIMEOUT", "The target did not pause in time."));
        }, timeoutMs);
        pausedWaiters.add(wake);
      });
    },
    close() {
      if (closedByUs) return;
      closedByUs = true;
      rejectAll();
      socket.terminate();
    },
  };
}

/**
 * Releases the initial `--inspect-brk` wait and observes the first pause.
 * Order matters: the Debugger domain is enabled first so the pause is seen.
 */
export async function initializeInspector(connection: InspectorConnection): Promise<void> {
  await connection.send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
  await connection.send("Debugger.enable");
  await connection.send("Runtime.runIfWaitingForDebugger");
  await connection.waitForPaused();
}

export async function resumeTarget(connection: InspectorConnection): Promise<void> {
  await connection.send("Debugger.resume");
}

export async function pauseTarget(connection: InspectorConnection): Promise<void> {
  if (connection.isPaused()) return;
  await connection.send("Debugger.pause");
  await connection.waitForPaused();
}

export interface EvaluationSummary {
  readonly type: string;
  readonly subtype?: string;
  /** Present only for primitives. Objects are summarized by `description`. */
  readonly value?: string | number | boolean | null;
  readonly description?: string;
  readonly exception?: string;
}

const truncate = (text: string): string =>
  text.length > CDP_MAX_RESULT_TEXT_CHARS ? `${text.slice(0, CDP_MAX_RESULT_TEXT_CHARS)}…` : text;

interface RemoteObject {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly value?: unknown;
  readonly description?: unknown;
}

/** Evaluates in the target's global context. Never returns objects by value. */
export async function evaluateInTarget(connection: InspectorConnection, expression: string): Promise<EvaluationSummary> {
  const reply = await connection.send("Runtime.evaluate", {
    expression,
    silent: true,
    returnByValue: false,
    generatePreview: false,
    timeout: CDP_COMMAND_TIMEOUT_MS,
  });
  const exception = (reply.exceptionDetails as { text?: unknown; exception?: RemoteObject } | undefined) ?? undefined;
  if (exception) {
    const text =
      typeof exception.exception?.description === "string"
        ? exception.exception.description
        : typeof exception.text === "string"
          ? exception.text
          : "Evaluation threw.";
    return { type: "exception", exception: truncate(text) };
  }
  const remote = (reply.result as RemoteObject | undefined) ?? {};
  const value = remote.value;
  const primitive =
    typeof value === "string" ? truncate(value) : typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined;
  return {
    type: typeof remote.type === "string" ? remote.type : "unknown",
    ...(typeof remote.subtype === "string" ? { subtype: remote.subtype } : {}),
    ...(primitive !== undefined ? { value: primitive } : {}),
    ...(typeof remote.description === "string" ? { description: truncate(remote.description) } : {}),
  };
}
