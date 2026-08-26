import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authorizeControlPlaneRequest,
  CONTROL_PLANE_SERVICE_ID,
  isControlPlanePublicPath,
  issueReauthTicket,
  resetConsumedReauthTicketsForTests,
  resolveControlPlanePrincipal,
  verifyReauthTicket,
} from "../control-plane-auth.js";

function fakeReq(auth?: string, remote = "127.0.0.1"): IncomingMessage {
  return {
    headers: auth ? { authorization: auth } : {},
    socket: { remoteAddress: remote },
  } as IncomingMessage;
}

function fakeRes(): ServerResponse & { status: number; body: string } {
  const out = {
    status: 200,
    body: "",
    headersSent: false,
    writeHead(code: number) {
      out.status = code;
      return out;
    },
    setHeader() {
      return out;
    },
    end(chunk?: string) {
      if (chunk) out.body = chunk;
      return out;
    },
  };
  return out as unknown as ServerResponse & { status: number; body: string };
}

describe("Control Plane auth (ADR-021)", () => {
  afterEach(() => {
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    delete process.env.NODE_ENV;
    resetConsumedReauthTicketsForTests();
  });

  it("status is always public", () => {
    expect(isControlPlanePublicPath("/api/v1/status")).toBe(true);
    expect(isControlPlanePublicPath("/dashboard")).toBe(false);
  });

  it("requires bearer token when configured", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "unit-test-token-value";
    const denied = fakeRes();
    expect(
      authorizeControlPlaneRequest(fakeReq(), denied, "/dashboard"),
    ).toBe(false);
    expect(denied.status).toBe(401);

    const allowed = fakeRes();
    expect(
      authorizeControlPlaneRequest(
        fakeReq("Bearer unit-test-token-value"),
        allowed,
        "/dashboard",
      ),
    ).toBe(true);
  });

  it("fails closed in production without a token", () => {
    process.env.NODE_ENV = "production";
    const res = fakeRes();
    expect(authorizeControlPlaneRequest(fakeReq(), res, "/dashboard")).toBe(false);
    expect(res.status).toBe(503);
  });

  it("dev without a token is loopback-only", () => {
    process.env.NODE_ENV = "development";
    const local = fakeRes();
    expect(
      authorizeControlPlaneRequest(fakeReq(undefined, "127.0.0.1"), local, "/dashboard"),
    ).toBe(true);
    const remote = fakeRes();
    expect(
      authorizeControlPlaneRequest(fakeReq(undefined, "10.0.0.8"), remote, "/dashboard"),
    ).toBe(false);
    expect(remote.status).toBe(403);
  });

  it("issues a time-bounded reauth ticket and rejects a forged one", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "unit-test-token-value";
    const { ticket } = issueReauthTicket();
    expect(verifyReauthTicket(ticket)).toBe(true);
    expect(verifyReauthTicket("not-a-ticket")).toBe(false);
    const expired = issueReauthTicket(Date.now() - 10 * 60 * 1000);
    expect(verifyReauthTicket(expired.ticket)).toBe(false);
  });

  it("consumes a reauth ticket so it cannot be replayed", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "unit-test-token-value";
    const { ticket } = issueReauthTicket();
    expect(verifyReauthTicket(ticket)).toBe(true);
    expect(verifyReauthTicket(ticket)).toBe(false);
  });

  it("attributes Control Plane callers as SERVICE, never atlas-owner", () => {
    const principal = resolveControlPlanePrincipal();
    expect(principal.kind).toBe("SERVICE");
    expect(principal.id).toBe(CONTROL_PLANE_SERVICE_ID);
    expect(principal.id).not.toBe("atlas-owner");
  });
});
