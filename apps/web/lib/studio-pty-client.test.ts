import { describe, expect, it } from "vitest";
import {
  consumePtySseBuffer,
  studioPtyEventsUrl,
  studioPtyWsUrl,
} from "./studio-pty-client";

describe("studio PTY client URLs", () => {
  it("converts the API origin to a ticketed websocket path", () => {
    const url = studioPtyWsUrl(
      "http://localhost:4000",
      "/api/v1/projects/00000000-0000-4000-8000-000000000001/studio/pty/sessions/00000000-0000-4000-8000-000000000002/stream",
      "ticket-1",
    );
    expect(url).toBe(
      "ws://localhost:4000/api/v1/projects/00000000-0000-4000-8000-000000000001/studio/pty/sessions/00000000-0000-4000-8000-000000000002/stream?ticket=ticket-1",
    );
  });

  it("builds a ticketed SSE URL on the API origin", () => {
    const url = studioPtyEventsUrl(
      "http://localhost:4000",
      "/api/v1/projects/00000000-0000-4000-8000-000000000001/studio/pty/sessions/00000000-0000-4000-8000-000000000002/events",
      "ticket-1",
    );
    expect(url).toBe(
      "http://localhost:4000/api/v1/projects/00000000-0000-4000-8000-000000000001/studio/pty/sessions/00000000-0000-4000-8000-000000000002/events?ticket=ticket-1",
    );
  });

  it("parses SSE data frames without treating keep-alives as events", () => {
    const { buffer, events } = consumePtySseBuffer(
      ':ping\n\ndata: {"type":"data","data":"hi"}\n\ndata: {"type":"ready"',
    );
    expect(events).toEqual([{ type: "data", data: "hi" }]);
    expect(buffer).toContain('"type":"ready"');
  });
});
