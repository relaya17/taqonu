import { describe, expect, it } from "vitest";
import {
  clearSupabaseSessionCookie,
  readSupabaseSessionCookie,
  resolveRequestSupabaseAccessToken,
  serializeSupabaseSessionCookie,
} from "./supabase-session.js";

const notLiveEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me", // isLiveSupabase() treats this as not-live
};

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
