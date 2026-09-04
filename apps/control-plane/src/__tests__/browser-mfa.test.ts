import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateControlBrowser,
  completeControlBrowserMfa,
} from "../browser-session.js";

describe("Control Plane browser MFA", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ATLAS_API_URL;
  });

  it("does not issue a session when the API requires MFA", async () => {
    process.env.ATLAS_API_URL = "http://127.0.0.1:4000";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ mfaRequired: true, mfaToken: "challenge-token-abcdefghijklmnopqrstuvwxyz" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await authenticateControlBrowser("op@atlas.local", "secret");
    expect(result).toEqual({
      status: "mfa_required",
      mfaToken: "challenge-token-abcdefghijklmnopqrstuvwxyz",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("completes privileged login only after MFA verify succeeds", async () => {
    process.env.ATLAS_API_URL = "http://127.0.0.1:4000";
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/api/v1/auth/mfa/verify");
      return {
        ok: true,
        json: async () => ({
          role: "owner",
          user: { id: "11111111-1111-4111-8111-111111111111" },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const session = await completeControlBrowserMfa("challenge-token-abcdefghijklmnopqrstuvwxyz", "123456");
    expect(session).toEqual({
      role: "OWNER",
      subject: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("fail-closes when MFA verify is rejected", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      completeControlBrowserMfa("challenge-token-abcdefghijklmnopqrstuvwxyz", "000000"),
    ).resolves.toBeNull();
  });
});
