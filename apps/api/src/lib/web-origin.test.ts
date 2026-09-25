import { describe, expect, it } from "vitest";
import { isAllowedWebOrigin } from "./web-origin.js";

describe("isAllowedWebOrigin", () => {
  it("allows exact WEB_ORIGIN", () => {
    expect(
      isAllowedWebOrigin("http://localhost:3000", "http://localhost:3000"),
    ).toBe(true);
  });

  it("allows loopback host alias on same port", () => {
    expect(
      isAllowedWebOrigin("http://127.0.0.1:3000", "http://localhost:3000"),
    ).toBe(true);
    expect(
      isAllowedWebOrigin("http://localhost:3000", "http://127.0.0.1:3000"),
    ).toBe(true);
  });

  it("rejects different ports or hosts", () => {
    expect(
      isAllowedWebOrigin("http://127.0.0.1:3001", "http://localhost:3000"),
    ).toBe(false);
    expect(
      isAllowedWebOrigin("http://evil.example", "http://localhost:3000"),
    ).toBe(false);
  });

  it("allows Control and Atlas Admin loopback surfaces", () => {
    expect(
      isAllowedWebOrigin("http://127.0.0.1:3100", "http://localhost:3000"),
    ).toBe(true);
    expect(
      isAllowedWebOrigin("http://localhost:3200", "http://localhost:3000"),
    ).toBe(true);
  });

  it("allows missing origin (non-browser)", () => {
    expect(isAllowedWebOrigin(undefined, "http://localhost:3000")).toBe(true);
  });

  it("allows the Production Studio origin only when WEB_ORIGIN is that origin", () => {
    expect(
      isAllowedWebOrigin(
        "https://taqonu-web.vercel.app",
        "https://taqonu-web.vercel.app",
      ),
    ).toBe(true);
    expect(
      isAllowedWebOrigin("https://taqonu-web.vercel.app", "http://localhost:3000"),
    ).toBe(false);
    expect(
      isAllowedWebOrigin("https://evil.example", "https://taqonu-web.vercel.app"),
    ).toBe(false);
  });
});
