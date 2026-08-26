import { describe, expect, it, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applyControlPlaneSecurityHeaders,
  checkRateLimit,
  hashIdempotencyBody,
  lookupIdempotency,
  resetControlPlaneHardeningForTests,
  resolveRequestId,
  setRateLimitMaxForTests,
  storeIdempotentResponse,
} from "../services/control-plane-hardening.js";

function fakeReq(headers: Record<string, string> = {}, remote = "127.0.0.1"): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: remote },
  } as IncomingMessage;
}

function fakeRes(): ServerResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as ServerResponse & { headers: Record<string, string> };
}

describe("Control Plane hardening", () => {
  beforeEach(() => {
    resetControlPlaneHardeningForTests();
  });

  it("echoes X-Request-Id or mints one", () => {
    expect(resolveRequestId(fakeReq({ "x-request-id": "req_from_client" }))).toBe(
      "req_from_client",
    );
    expect(resolveRequestId(fakeReq())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sets nosniff, frame deny, and request id on the response", () => {
    const res = fakeRes();
    applyControlPlaneSecurityHeaders(res, "req_abc");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["X-Frame-Options"]).toBe("DENY");
    expect(res.headers["X-Request-Id"]).toBe("req_abc");
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("rate-limits a noisy client", () => {
    setRateLimitMaxForTests(2);
    const req = fakeReq({}, "10.0.0.9");
    expect(checkRateLimit(req).allowed).toBe(true);
    expect(checkRateLimit(req).allowed).toBe(true);
    expect(checkRateLimit(req).allowed).toBe(false);
  });

  it("replays an identical idempotent write and conflicts on a mutated body", () => {
    const key = "idem-1";
    const hashA = hashIdempotencyBody({ op: "inspect" });
    const hashB = hashIdempotencyBody({ op: "request_agent_run" });
    expect(lookupIdempotency(key, hashA).kind).toBe("fresh");
    storeIdempotentResponse(key, hashA, 200, { decision: "ALLOW" });
    const replay = lookupIdempotency(key, hashA);
    expect(replay.kind).toBe("replay");
    if (replay.kind !== "replay") throw new Error("expected replay");
    expect(replay.status).toBe(200);
    expect(lookupIdempotency(key, hashB).kind).toBe("conflict");
  });
});
