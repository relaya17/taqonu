import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authorizeControlPlaneRequest,
  CONTROL_PLANE_SERVICE_ID,
  isControlPlanePublicPath,
  isCivioConnectorIngressPath,
  isOwnerPrincipal,
  issueReauthTicket,
  requireOwnerRole,
  resetConsumedReauthTicketsForTests,
  resetPrincipalRoleForTests,
  resolveControlPlanePrincipal,
  verifyReauthTicket,
} from "../control-plane-auth.js";
import {
  issueControlBrowserSession,
  readControlBrowserSession,
} from "../browser-session.js";

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
    delete process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN;
    delete process.env.NODE_ENV;
    resetConsumedReauthTicketsForTests();
    resetPrincipalRoleForTests();
  });

  it("status is always public", () => {
    expect(isControlPlanePublicPath("/api/v1/status")).toBe(true);
    expect(isControlPlanePublicPath("/dashboard")).toBe(false);
    expect(isControlPlanePublicPath("/api/v1/connectors/civio/events")).toBe(false);
    expect(isCivioConnectorIngressPath("/api/v1/connectors/civio/events")).toBe(true);
  });

  it("lets Civio ingress past Control bearer so HMAC can fail closed", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "unit-test-token-value";
    expect(
      authorizeControlPlaneRequest(
        fakeReq(),
        fakeRes(),
        "/api/v1/connectors/civio/events",
      ),
    ).toBe(true);
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

  it("accepts a signed browser session and rejects tampering", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "unit-test-token-value";
    const pair = issueControlBrowserSession("OWNER", "owner-1").split(";")[0]!;
    const request = fakeReq();
    request.headers.cookie = pair;
    expect(readControlBrowserSession(request)).toEqual({ role: "OWNER", subject: "owner-1" });
    expect(authorizeControlPlaneRequest(request, fakeRes(), "/dashboard")).toBe(true);
    expect(resolveControlPlanePrincipal().role).toBe("OWNER");

    request.headers.cookie = `${pair}x`;
    expect(readControlBrowserSession(request)).toBeNull();
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

  it("distinguishes owner token from operator token", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "operator-secret";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN = "owner-secret";

    // Operator token → OPERATOR role
    const operatorRes = fakeRes();
    expect(
      authorizeControlPlaneRequest(
        fakeReq("Bearer operator-secret"),
        operatorRes,
        "/dashboard",
      ),
    ).toBe(true);
    expect(resolveControlPlanePrincipal().role).toBe("OPERATOR");
    expect(isOwnerPrincipal()).toBe(false);

    // Owner token → OWNER role
    const ownerRes = fakeRes();
    expect(
      authorizeControlPlaneRequest(
        fakeReq("Bearer owner-secret"),
        ownerRes,
        "/dashboard",
      ),
    ).toBe(true);
    expect(resolveControlPlanePrincipal().role).toBe("OWNER");
    expect(isOwnerPrincipal()).toBe(true);
  });

  it("requireOwnerRole allows owner and denies operator", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "operator-secret";
    process.env.ATLAS_CONTROL_PLANE_OWNER_TOKEN = "owner-secret";

    // Operator tries owner-only op
    authorizeControlPlaneRequest(
      fakeReq("Bearer operator-secret"),
      fakeRes(),
      "/dashboard",
    );
    const operatorDenied = fakeRes();
    expect(requireOwnerRole(operatorDenied)).toBe(false);
    expect(operatorDenied.status).toBe(403);

    // Owner can proceed
    authorizeControlPlaneRequest(
      fakeReq("Bearer owner-secret"),
      fakeRes(),
      "/dashboard",
    );
    const ownerAllowed = fakeRes();
    expect(requireOwnerRole(ownerAllowed)).toBe(true);
  });

  it("dev loopback defaults to OPERATOR, not OWNER", () => {
    process.env.NODE_ENV = "development";
    const res = fakeRes();
    expect(
      authorizeControlPlaneRequest(fakeReq(undefined, "127.0.0.1"), res, "/dashboard"),
    ).toBe(true);
    expect(resolveControlPlanePrincipal().role).toBe("OPERATOR");
    expect(isOwnerPrincipal()).toBe(false);
  });

  it("uses a browser-session fallback only outside production", () => {
    process.env.NODE_ENV = "development";
    expect(() => issueControlBrowserSession("OWNER", "dev-owner")).not.toThrow();

    process.env.NODE_ENV = "production";
    expect(() => issueControlBrowserSession("OWNER", "dev-owner")).toThrow(
      "ATLAS_CONTROL_PLANE_TOKEN is required",
    );
  });
});
