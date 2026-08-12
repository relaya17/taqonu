import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AtlasError } from "@atlas/shared";
import {
  GitHubAppTokenCache,
  exchangeInstallationAccessToken,
  fetchGitHubAppInstallation,
  normalizeGithubPrivateKey,
  signGitHubAppJwt,
} from "./app-auth.js";

function generateTestKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return { privateKey, publicKey };
}

function decodeJwt(jwt: string): {
  header: { alg: string; typ: string };
  payload: { iat: number; exp: number; iss: string };
  signingInput: string;
  signature: Buffer;
} {
  const [headerB64, payloadB64, signatureB64] = jwt.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("malformed JWT");
  }
  return {
    header: JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")),
    signingInput: `${headerB64}.${payloadB64}`,
    signature: Buffer.from(signatureB64, "base64url"),
  };
}

describe("normalizeGithubPrivateKey", () => {
  it("restores real newlines from literal \\n escapes", () => {
    const withEscapes = "-----BEGIN RSA PRIVATE KEY-----\\nABC\\n-----END RSA PRIVATE KEY-----";
    expect(normalizeGithubPrivateKey(withEscapes)).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----",
    );
  });

  it("leaves a key with real newlines untouched", () => {
    const withRealNewlines = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----";
    expect(normalizeGithubPrivateKey(withRealNewlines)).toBe(withRealNewlines);
  });
});

describe("signGitHubAppJwt", () => {
  it("produces a valid RS256 JWT with iss=appId and a ~10min window", () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const now = new Date("2026-08-12T12:00:00.000Z");

    const jwt = signGitHubAppJwt({ appId: "123456", privateKeyPem: privateKey, now });
    const decoded = decodeJwt(jwt);

    expect(decoded.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decoded.payload.iss).toBe("123456");

    const nowSeconds = Math.floor(now.getTime() / 1000);
    // iat backdated ~60s for clock drift
    expect(decoded.payload.iat).toBe(nowSeconds - 60);
    // exp stays under GitHub's 10-minute cap measured from "now"
    expect(decoded.payload.exp).toBeGreaterThan(nowSeconds);
    expect(decoded.payload.exp - nowSeconds).toBeLessThanOrEqual(600);

    const isValid = cryptoVerify(
      "RSA-SHA256",
      Buffer.from(decoded.signingInput),
      publicKey,
      decoded.signature,
    );
    expect(isValid).toBe(true);
  });

  it("accepts private keys with escaped newlines", () => {
    const { privateKey } = generateTestKeyPair();
    const escaped = privateKey.replace(/\n/g, "\\n");
    expect(() => signGitHubAppJwt({ appId: "1", privateKeyPem: escaped })).not.toThrow();
  });

  it("throws a CONFIG_ERROR AtlasError for a malformed key", () => {
    expect(() =>
      signGitHubAppJwt({ appId: "1", privateKeyPem: "not-a-real-key" }),
    ).toThrow(AtlasError);
  });
});

describe("exchangeInstallationAccessToken", () => {
  it("POSTs to /app/installations/{id}/access_tokens with a bearer JWT and returns the token", async () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const fetchImpl = vi.fn(async (
      url: string | URL,
      init?: { method?: string; headers?: unknown },
    ) => {
      expect(String(url)).toBe(
        "https://api.github.com/app/installations/42/access_tokens",
      );
      expect(init?.method).toBe("POST");
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      expect(auth.startsWith("Bearer ")).toBe(true);
      const jwt = auth.slice("Bearer ".length);
      const decoded = decodeJwt(jwt);
      const isValid = cryptoVerify(
        "RSA-SHA256",
        Buffer.from(decoded.signingInput),
        publicKey,
        decoded.signature,
      );
      expect(isValid).toBe(true);

      return new Response(
        JSON.stringify({
          token: "ghs_installation_token",
          expires_at: "2026-08-12T13:00:00Z",
          repository_selection: "selected",
          permissions: { contents: "read" },
        }),
        { status: 201 },
      );
    });

    const result = await exchangeInstallationAccessToken({
      installationId: "42",
      appId: "999",
      privateKeyPem: privateKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.token).toBe("ghs_installation_token");
    expect(result.expiresAt).toBe("2026-08-12T13:00:00Z");
    expect(result.repositorySelection).toBe("selected");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws INTEGRATION_ERROR when GitHub responds with a non-2xx status", async () => {
    const { privateKey } = generateTestKeyPair();
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 404 }),
    );

    await expect(
      exchangeInstallationAccessToken({
        installationId: "42",
        appId: "999",
        privateKeyPem: privateKey,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/installation token exchange failed \(404\)/);
  });
});

describe("fetchGitHubAppInstallation", () => {
  it("returns normalized installation info on success", async () => {
    const { privateKey } = generateTestKeyPair();
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.github.com/app/installations/7");
      return new Response(
        JSON.stringify({
          id: 7,
          account: { login: "arlet", type: "User" },
          target_type: "User",
          repository_selection: "all",
          suspended_at: null,
        }),
        { status: 200 },
      );
    });

    const info = await fetchGitHubAppInstallation({
      installationId: "7",
      appId: "999",
      privateKeyPem: privateKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(info).toEqual({
      id: 7,
      accountLogin: "arlet",
      accountType: "User",
      targetType: "User",
      repositorySelection: "all",
      suspendedAt: null,
    });
  });

  it("throws a 404 AtlasError when the installation does not exist", async () => {
    const { privateKey } = generateTestKeyPair();
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));

    await expect(
      fetchGitHubAppInstallation({
        installationId: "999999",
        appId: "999",
        privateKeyPem: privateKey,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("GitHubAppTokenCache", () => {
  it("reuses a cached token until it nears expiry", async () => {
    const { privateKey } = generateTestKeyPair();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response(
        JSON.stringify({
          token: `token-${call}`,
          expires_at: "2026-08-12T13:00:00Z",
        }),
        { status: 201 },
      );
    });

    const cache = new GitHubAppTokenCache({
      appId: "999",
      privateKeyPem: privateKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await cache.getToken("42", new Date("2026-08-12T12:00:00Z"));
    const second = await cache.getToken("42", new Date("2026-08-12T12:05:00Z"));

    expect(first).toBe("token-1");
    expect(second).toBe("token-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the cached token is within the refresh buffer of expiry", async () => {
    const { privateKey } = generateTestKeyPair();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response(
        JSON.stringify({
          token: `token-${call}`,
          expires_at: "2026-08-12T13:00:00Z",
        }),
        { status: 201 },
      );
    });

    const cache = new GitHubAppTokenCache(
      {
        appId: "999",
        privateKeyPem: privateKey,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      60_000,
    );

    const first = await cache.getToken("42", new Date("2026-08-12T12:00:00Z"));
    // 12:59:30 is within the 60s refresh buffer of the 13:00:00 expiry
    const second = await cache.getToken("42", new Date("2026-08-12T12:59:30Z"));

    expect(first).toBe("token-1");
    expect(second).toBe("token-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a refresh on the next call", async () => {
    const { privateKey } = generateTestKeyPair();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response(
        JSON.stringify({ token: `token-${call}`, expires_at: "2026-08-12T13:00:00Z" }),
        { status: 201 },
      );
    });

    const cache = new GitHubAppTokenCache({
      appId: "999",
      privateKeyPem: privateKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await cache.getToken("42", new Date("2026-08-12T12:00:00Z"));
    cache.invalidate("42");
    await cache.getToken("42", new Date("2026-08-12T12:00:01Z"));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
