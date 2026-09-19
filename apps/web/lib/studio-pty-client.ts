export interface StudioPtySnapshot {
  readonly sessionId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly shell: "powershell" | "cmd";
  readonly cwd: string;
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly status: "running" | "exited" | "killed";
  readonly exitCode: number | null;
  readonly createdAt: string;
}

export interface StudioPtyCreated {
  readonly session: StudioPtySnapshot;
  readonly ticket: string;
  readonly streamPath: string;
  readonly eventsPath: string;
}

export function studioPtyTicketQuery(path: string, ticket: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}ticket=${encodeURIComponent(ticket)}`;
}

export function studioPtyWsUrl(
  httpOrigin: string,
  streamPath: string,
  ticket: string,
): string {
  const ws = httpOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${ws}${studioPtyTicketQuery(streamPath, ticket)}`;
}

export function studioPtyEventsUrl(
  httpOrigin: string,
  eventsPath: string,
  ticket: string,
): string {
  return `${httpOrigin.replace(/\/$/, "")}${studioPtyTicketQuery(eventsPath, ticket)}`;
}

export function consumePtySseBuffer(buffer: string): {
  buffer: string;
  events: Array<Record<string, unknown>>;
} {
  const events: Array<Record<string, unknown>> = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  let rest = normalized;
  let idx = rest.indexOf("\n\n");
  while (idx >= 0) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        const parsed = JSON.parse(json) as unknown;
        if (parsed && typeof parsed === "object") {
          events.push(parsed as Record<string, unknown>);
        }
      } catch {
        /* ignore keep-alive / partial JSON */
      }
    }
    idx = rest.indexOf("\n\n");
  }
  return { buffer: rest, events };
}
