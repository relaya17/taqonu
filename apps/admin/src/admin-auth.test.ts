import { describe, expect, it } from "vitest";
import { authorizeAdminRequest } from "./admin-auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { issueAdminBrowserSession, readAdminBrowserSession } from "./browser-session.js";

function fakeReq(auth?: string, remote = "127.0.0.1"): IncomingMessage {
  return {
    headers: auth ? { authorization: auth } : {},
    socket: { remoteAddress: remote },
  } as IncomingMessage;
}

function fakeRes(): ServerResponse & { status: number } {
  const out = {
    status: 200,
    writeHead(code: number) {
      out.status = code;
      return out;
    },
    end() {
      return out;
    },
  };
  return out as unknown as ServerResponse & { status: number };
}

describe("apps/admin auth", () => {
  it("requires a bearer token when configured", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "admin-test-token";
    const denied = fakeRes();
    expect(authorizeAdminRequest(fakeReq(), denied)).toBe(false);
    expect(denied.status).toBe(401);
    const allowed = fakeRes();
    expect(
      authorizeAdminRequest(fakeReq("Bearer admin-test-token"), allowed),
    ).toBe(true);
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
  });

  it("accepts an owner browser session and rejects tampering", () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "admin-test-token";
    const pair = issueAdminBrowserSession("owner-1").split(";")[0]!;
    const request = fakeReq();
    request.headers.cookie = pair;
    expect(readAdminBrowserSession(request)).toEqual({ subject: "owner-1" });
    expect(authorizeAdminRequest(request, fakeRes())).toBe(true);

    request.headers.cookie = `${pair}x`;
    expect(readAdminBrowserSession(request)).toBeNull();
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
  });
});
