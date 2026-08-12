import { afterEach, describe, expect, it, vi } from "vitest";
import { createUserScopedClient } from "./client.js";

describe("createUserScopedClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the user's access token as a Bearer Authorization header on every request", async () => {
    const captured: { headers: Headers }[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured.push({ headers: new Headers(init?.headers) });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = createUserScopedClient({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      accessToken: "user-jwt-abc123",
    });

    await client.from("projects").select("*");

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]?.headers.get("authorization")).toBe("Bearer user-jwt-abc123");
  });
});
