import { describe, expect, it } from "vitest";
import {
  buildGitHubAppSetupUrl,
  extractIncrementalWebhookSync,
  matchProjectByRepoFullName,
  resolveGitHubAppSlug,
} from "./webhook-sync.js";

describe("matchProjectByRepoFullName", () => {
  const projects = [
    {
      id: "1",
      slug: "brokeros",
      name: "BrokerOS",
      githubFullName: "arlet/brokeros",
    },
    { id: "2", slug: "other-app", name: "Other App" },
  ];

  it("matches prior observation fullName first", () => {
    expect(matchProjectByRepoFullName("arlet/brokeros", projects)?.id).toBe("1");
  });

  it("falls back to slug heuristic", () => {
    expect(matchProjectByRepoFullName("acme/other-app", projects)?.id).toBe("2");
  });
});

describe("extractIncrementalWebhookSync", () => {
  it("extracts push headSha", () => {
    const result = extractIncrementalWebhookSync({
      event: "push",
      body: {
        after: "abc123",
        repository: {
          full_name: "arlet/brokeros",
          default_branch: "main",
          private: true,
          html_url: "https://github.com/arlet/brokeros",
        },
      },
    });
    expect(result.shouldSync).toBe(true);
    expect(result.headSha).toBe("abc123");
    expect(result.repo?.fullName).toBe("arlet/brokeros");
  });

  it("extracts pull_request head sha and CI when present", () => {
    const result = extractIncrementalWebhookSync({
      event: "pull_request",
      body: {
        pull_request: { head: { sha: "prsha" } },
        check_suite: { conclusion: "success" },
        repository: { full_name: "arlet/brokeros" },
      },
    });
    expect(result.headSha).toBe("prsha");
    expect(result.recentCiStatus).toBe("success");
  });

  it("skips non-incremental events", () => {
    const result = extractIncrementalWebhookSync({
      event: "ping",
      body: { repository: { full_name: "arlet/brokeros" } },
    });
    expect(result.shouldSync).toBe(false);
    expect(result.reason).toBe("event_not_incremental");
  });
});

describe("setup url helpers", () => {
  it("builds install URL from slug", () => {
    expect(buildGitHubAppSetupUrl("Atlas Core")).toBe(
      "https://github.com/apps/atlas-core/installations/new",
    );
  });

  it("resolves slug from name when slug missing", () => {
    expect(resolveGitHubAppSlug({ GITHUB_APP_NAME: "My Atlas App" })).toBe(
      "my-atlas-app",
    );
  });

  it("appends an encoded state param when provided", () => {
    expect(buildGitHubAppSetupUrl("atlas-core", "abc.def")).toBe(
      "https://github.com/apps/atlas-core/installations/new?state=abc.def",
    );
  });
});
