import { afterEach, describe, expect, it } from "vitest";
import {
  assertCookieMutationOrigin,
  cookieCsrfRequiresOrigin,
  hasAtlasSessionCookie,
  originFromReferer,
} from "./cookie-csrf.js";

const WEB = "http://localhost:3000";

describe("cookie CSRF helper", () => {
  afterEach(() => {
    delete process.env.ATLAS_REQUIRE_COOKIE_CSRF;
  });

  it("ignores GET and bearer-authenticated writes", () => {
    expect(() =>
      assertCookieMutationOrigin({
        method: "GET",
        origin: "http://evil.example",
        referer: undefined,
        cookie: "atlas_session=abc",
        authorization: undefined,
        webOrigin: WEB,
        requireOrigin: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertCookieMutationOrigin({
        method: "POST",
        origin: "http://evil.example",
        referer: undefined,
        cookie: "atlas_session=abc",
        authorization: "Bearer service-token",
        webOrigin: WEB,
        requireOrigin: true,
      }),
    ).not.toThrow();
  });

  it("refuses a cookie write from a foreign Origin", () => {
    expect(() =>
      assertCookieMutationOrigin({
        method: "POST",
        origin: "http://evil.example",
        referer: undefined,
        cookie: "atlas_session=abc",
        authorization: undefined,
        webOrigin: WEB,
        requireOrigin: false,
      }),
    ).toThrow(/refused from this origin/i);
  });

  it("accepts Studio loopback Origin and Referer fallback", () => {
    expect(() =>
      assertCookieMutationOrigin({
        method: "PUT",
        origin: "http://127.0.0.1:3000",
        referer: undefined,
        cookie: "atlas_session=abc",
        authorization: undefined,
        webOrigin: WEB,
        requireOrigin: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertCookieMutationOrigin({
        method: "DELETE",
        origin: undefined,
        referer: "http://localhost:3000/en/settings",
        cookie: "atlas_session=abc",
        authorization: undefined,
        webOrigin: WEB,
        requireOrigin: true,
      }),
    ).not.toThrow();
    expect(originFromReferer("http://localhost:3000/en/settings")).toBe(
      "http://localhost:3000",
    );
  });

  it("requires Origin in production-shaped mode", () => {
    process.env.ATLAS_REQUIRE_COOKIE_CSRF = "1";
    expect(cookieCsrfRequiresOrigin()).toBe(true);
    expect(hasAtlasSessionCookie("atlas_session=abc; other=1")).toBe(true);
    expect(() =>
      assertCookieMutationOrigin({
        method: "POST",
        origin: undefined,
        referer: undefined,
        cookie: "atlas_session=abc",
        authorization: undefined,
        webOrigin: WEB,
        requireOrigin: true,
      }),
    ).toThrow(/requires an allowed Origin/i);
  });
});
