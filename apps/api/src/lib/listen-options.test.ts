import { afterEach, describe, expect, it } from "vitest";
import { apiListenOptions, resolveApiListenPort } from "./listen-options.js";

const saved = {
  API_PORT: process.env.API_PORT,
  PORT: process.env.PORT,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveApiListenPort", () => {
  it("uses API_PORT even when a parent PORT is set", () => {
    process.env.API_PORT = "4000";
    process.env.PORT = "3001";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(resolveApiListenPort()).toBe(4000);
  });

  it("ignores a local parent PORT when API_PORT is unset", () => {
    delete process.env.API_PORT;
    process.env.PORT = "3001";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(resolveApiListenPort()).toBe(4000);
  });

  it("uses PORT on Vercel when API_PORT is unset", () => {
    delete process.env.API_PORT;
    process.env.PORT = "3001";
    process.env.VERCEL = "1";
    expect(resolveApiListenPort()).toBe(3001);
  });
});

describe("apiListenOptions", () => {
  it("honors an explicit HOST (private-plane loopback)", () => {
    expect(apiListenOptions(4000, "127.0.0.1")).toEqual({
      port: 4000,
      host: "127.0.0.1",
    });
  });

  it("uses dual-stack when HOST is empty (Windows Chrome localhost)", () => {
    expect(apiListenOptions(4000, "")).toEqual({ port: 4000, ipv6Only: false });
  });
});
