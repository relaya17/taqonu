import { describe, expect, it } from "vitest";
import { authorizeAdminRequest } from "./admin-auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";

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
});
