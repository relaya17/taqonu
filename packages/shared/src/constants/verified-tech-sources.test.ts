import { describe, expect, it } from "vitest";
import {
  buildVerifiedTechSourcesPack,
  isAuthorizedVerifiedTechUrl,
} from "./verified-tech-sources.js";

describe("verified tech sources authorization", () => {
  it("allows MDN host", () => {
    expect(
      isAuthorizedVerifiedTechUrl(
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      ),
    ).toBe(true);
  });

  it("rejects blog hosts", () => {
    expect(isAuthorizedVerifiedTechUrl("https://medium.com/foo")).toBe(false);
    expect(isAuthorizedVerifiedTechUrl("https://random-blog.example/x")).toBe(
      false,
    );
    expect(isAuthorizedVerifiedTechUrl("not-a-url")).toBe(false);
  });

  it("builds downloadable pack", () => {
    const pack = buildVerifiedTechSourcesPack("2026-08-13T00:00:00.000Z");
    expect(pack.schema).toBe("atlas.verified-tech-sources.v1");
    expect(pack.count).toBeGreaterThan(10);
    expect(pack.hosts.length).toBeGreaterThan(5);
  });
});
