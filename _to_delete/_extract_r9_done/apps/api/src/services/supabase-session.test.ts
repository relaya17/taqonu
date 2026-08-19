import { describe, expect, it, vi, beforeEach } from "vitest";

const authGetUser = vi.fn();

vi.mock("@atlas/database", async () => {
  const actual =
    await vi.importActual<typeof import("@atlas/database")>("@atlas/database");
  return {
    ...actual,
    createDatabaseClients: () => ({
      anon: { auth: { getUser: authGetUser } },
      service: { auth: { getUser: authGetUser } },
    }),
  };
});

const {
  clearSupabaseSessionCookie,
  readSupabaseSessionCookie,
  resolveRequestSupabaseAccessToken,
  serializeSupabaseSessionCookie,
  verifySupabaseAccessToken,
} = await import("./supabase-session.js");

const notLiveEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me", // isLiveSupabase() treats this as not-live
};

const liveEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
};

beforeEach(() => {
  authGetUser.mockReset();
});

describe("supabase session cookie", () => {
  it("round-trips a session through serialize/read", () => {
    const cookie = serializeSupabaseSessionCookie({
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: 1_800_000_000_000,
    });
    // Emulate the raw Cookie header the browser would send back.
    const [pair] = cookie.split(";");
    const decoded = readSupabaseSessionCookie(pair);
    expect(decoded).toEqual({
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: 1_800_000_000_000,
    });
  });

  it("is HttpOnly and never exposed to client-side script", () => {
    const cookie = serializeSupabaseSessionCookie({
      accessToken: "at-123",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
    });
    expect(cookie).toContain("HttpOnly");
  });

  it("clears the cookie with Max-Age=0", () => {
    expect(clearSupabaseSessionCookie()).toContain("Max-Age=0");
  });

  it("returns null for a missing cookie header", () => {
    expect(readSupabaseSessionCookie(undefined)).toBeNull();
    expect(readSupabaseSessionCookie("other_cookie=abc")).toBeNull();
  });

  it("returns null for a malformed cookie value", () => {
    expect(readSupabaseSessionCookie("atlas_sb_session=not-json")).toBeNull();
  });

  it("returns null when required fields are missing from the payload", () => {
    const badPayload = encodeURIComponent(JSON.stringify({ refreshToken: "x" }));
    expect(readSupabaseSessionCookie(`atlas_sb_session=${badPayload}`)).toBeNull();
  });

  it("finds the cookie among multiple cookies in the header", () => {
    const cookie = serializeSupabaseSessionCookie({
      accessToken: "at-1",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
    });
    const [pair] = cookie.split(";");
    const header = `atlas_session=other-value; ${pair}; some_other=1`;
    expect(readSupabaseSessionCookie(header)?.accessToken).toBe("at-1");
  });
});

describe("resolveRequestSupabaseAccessToken", () => {
  it("returns null when Supabase is not live, without touching the cookie", async () => {
    const result = await resolveRequestSupabaseAccessToken(notLiveEnv, "atlas_sb_session=whatever");
    expect(result).toEqual({ accessToken: null, setCookie: null });
  });
});

describe("verifySupabaseAccessToken (the real trust boundary)", () => {
  it("returns null (and calls Supabase) for a token Supabase rejects — the forged-cookie case", async () => {
    authGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT: signature is invalid", status: 401 },
    });
    const result = await verifySupabaseAccessToken(liveEnv, "forged.token.value");
    expect(result).toBeNull();
    expect(authGetUser).toHaveBeenCalledWith("forged.token.value");
  });

  it("returns the verified user for a token Supabase accepts", async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "real@example.com",
          app_metadata: { atlas_role: "admin" },
          user_metadata: { full_name: "Real User" },
        },
      },
      error: null,
    });
    const result = await verifySupabaseAccessToken(liveEnv, "genuine.token.value");
    expect(result).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "real@example.com",
      appMetadata: { atlas_role: "admin" },
      userMetadata: { full_name: "Real User" },
    });
  });

  it("returns null without calling Supabase when not live", async () => {
    const result = await verifySupabaseAccessToken(notLiveEnv, "whatever");
    expect(result).toBeNull();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("returns null when the SDK call itself throws (network error etc.)", async () => {
    authGetUser.mockRejectedValue(new Error("network down"));
    const result = await verifySupabaseAccessToken(liveEnv, "whatever");
    expect(result).toBeNull();
  });
});
