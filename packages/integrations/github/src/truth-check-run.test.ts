import { describe, expect, it, vi } from "vitest";
import {
  buildTruthCheckRunBody,
  conclusionForRiskBand,
  postAtlasTruthCheckRun,
  resolveInstallationIdForCheck,
  splitRepoFullName,
} from "./truth-check-run.js";

describe("truth check run helpers", () => {
  it("maps risk bands to check conclusions", () => {
    expect(conclusionForRiskBand("CRITICAL")).toBe("failure");
    expect(conclusionForRiskBand("HIGH")).toBe("action_required");
    expect(conclusionForRiskBand("MEDIUM")).toBe("neutral");
    expect(conclusionForRiskBand("LOW")).toBe("success");
  });

  it("splits owner/repo", () => {
    expect(splitRepoFullName("acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
    });
    expect(splitRepoFullName("bad")).toBeNull();
  });

  it("builds completed check body", () => {
    const body = buildTruthCheckRunBody({
      headSha: "abc123",
      riskBand: "HIGH",
      riskScore: 720,
      topFindingTitle: "Payment after confirm",
      observeCycleId: "cycle-1",
      detailsUrl: "https://app.example/truth",
    });
    expect(body.name).toBe("Atlas Truth");
    expect(body.head_sha).toBe("abc123");
    expect(body.conclusion).toBe("action_required");
    expect(body.details_url).toBe("https://app.example/truth");
  });

  it("resolves installation id preference", () => {
    expect(
      resolveInstallationIdForCheck({
        webhookInstallationId: 99,
        projectInstallationId: "1",
      }),
    ).toBe("99");
    expect(
      resolveInstallationIdForCheck({
        webhookInstallationId: null,
        projectInstallationId: "7",
      }),
    ).toBe("7");
  });

  it("posts check run via fetch", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 42, html_url: "https://gh/check/42" }), {
        status: 201,
      }),
    );
    const result = await postAtlasTruthCheckRun({
      token: "t",
      fullName: "acme/widget",
      headSha: "deadbeef",
      riskBand: "LOW",
      riskScore: 10,
      topFindingTitle: null,
      observeCycleId: "c1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe(42);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
