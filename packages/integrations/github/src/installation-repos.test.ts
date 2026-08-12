import { describe, expect, it, vi } from "vitest";
import { listInstallationRepos } from "./installation-repos.js";

describe("listInstallationRepos", () => {
  it("pages through installation repositories", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 2,
          repositories: [
            {
              full_name: "acme/one",
              name: "one",
              private: false,
              html_url: "https://github.com/acme/one",
              default_branch: "main",
              description: null,
              language: "TypeScript",
              pushed_at: "2026-08-01T00:00:00Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 2,
          repositories: [
            {
              full_name: "acme/two",
              name: "two",
              private: true,
              html_url: "https://github.com/acme/two",
              default_branch: "main",
              description: "second",
              language: null,
              pushed_at: null,
            },
          ],
        }),
      });

    // First page returns 1 (<100) so loop stops after page 1 — use full page to test paging
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      full_name: `acme/r${i}`,
      name: `r${i}`,
      private: false,
      html_url: `https://github.com/acme/r${i}`,
      default_branch: "main",
      description: null,
      language: null,
      pushed_at: null,
    }));

    const pagedFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_count: 101, repositories: fullPage }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 101,
          repositories: [
            {
              full_name: "acme/last",
              name: "last",
              private: false,
              html_url: "https://github.com/acme/last",
              default_branch: "main",
              description: null,
              language: null,
              pushed_at: null,
            },
          ],
        }),
      });

    const repos = await listInstallationRepos({
      installationToken: "ghs_test",
      fetchImpl: pagedFetch as unknown as typeof fetch,
    });

    expect(repos).toHaveLength(101);
    expect(repos[100]?.full_name).toBe("acme/last");
    expect(pagedFetch).toHaveBeenCalledTimes(2);

    // single-page path
    const one = await listInstallationRepos({
      installationToken: "ghs_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(one).toHaveLength(1);
    expect(one[0]?.full_name).toBe("acme/one");
  });

  it("throws on non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    await expect(
      listInstallationRepos({
        installationToken: "ghs_bad",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/installation repositories list failed/);
  });
});
