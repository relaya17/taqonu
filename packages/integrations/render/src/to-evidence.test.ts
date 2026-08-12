import { describe, expect, it } from "vitest";
import { renderObservationToEvidenceDrafts } from "./to-evidence.js";

describe("renderObservationToEvidenceDrafts", () => {
  it("maps live production to OBSERVED + LIVE_PRODUCTION", () => {
    const drafts = renderObservationToEvidenceDrafts({
      serviceName: "api",
      serviceUrl: "https://api.onrender.com",
      environment: "production",
      status: "live",
      commitSha: "abc123",
      observedAt: "2026-08-12T00:00:00.000Z",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.epistemicState).toBe("OBSERVED");
    expect(drafts[0]?.authorityRank).toBe("LIVE_PRODUCTION");
    expect(drafts[0]?.provider).toBe("render");
  });

  it("maps build_failed to UNVERIFIED", () => {
    const drafts = renderObservationToEvidenceDrafts({
      serviceName: "web",
      serviceUrl: null,
      environment: "preview",
      status: "build_failed",
      commitSha: null,
      observedAt: "2026-08-12T00:00:00.000Z",
    });
    expect(drafts[0]?.epistemicState).toBe("UNVERIFIED");
  });
});
