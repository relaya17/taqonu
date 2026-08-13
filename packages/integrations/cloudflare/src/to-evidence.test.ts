import { describe, expect, it } from "vitest";
import {
  cloudflareObservationToEvidenceDrafts,
  looksLikeCloudflareApiToken,
} from "./to-evidence.js";

describe("cloudflareObservationToEvidenceDrafts", () => {
  it("emits OBSERVED draft for live Workers", () => {
    const drafts = cloudflareObservationToEvidenceDrafts({
      accountLabel: "acme",
      externalAccountId: "cf-acc-1",
      product: "workers",
      status: "live",
      resourceName: "api-gateway",
      observedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.provider).toBe("cloudflare");
    expect(drafts[0]?.epistemicState).toBe("OBSERVED");
    expect(drafts[0]?.authorityRank).toBe("LIVE_PRODUCTION");
  });
});

describe("looksLikeCloudflareApiToken", () => {
  it("rejects short or whitespace tokens", () => {
    expect(looksLikeCloudflareApiToken("short")).toBe(false);
    expect(looksLikeCloudflareApiToken("has space in token value here")).toBe(
      false,
    );
  });

  it("accepts long opaque tokens", () => {
    expect(
      looksLikeCloudflareApiToken("abcdefghijklmnopqrstuvwxyz12"),
    ).toBe(true);
  });
});
