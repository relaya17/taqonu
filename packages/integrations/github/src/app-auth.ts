import { createSign } from "node:crypto";
import { AtlasError } from "@atlas/shared";

/**
 * GitHub App-level authentication: JWT signing (RS256) + installation
 * access token exchange, per https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "ArletOS-Atlas";
const API_VERSION = "2022-11-28";

/** Env often stores PEM keys with literal `\n` escapes — restore real newlines. */
export function normalizeGithubPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\\n") && !trimmed.includes("\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

function base64UrlFromString(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Sign a GitHub App JWT (RS256).
 * iat is backdated 60s to tolerate clock drift; exp is capped well under
 * GitHub's 10-minute maximum to leave a safety margin for request latency.
 */
export function signGitHubAppJwt(input: {
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly now?: Date;
  readonly expirySeconds?: number;
}): string {
  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expirySeconds = input.expirySeconds ?? 540; // 9 minutes — under GitHub's 10-minute cap
  const iat = nowSeconds - 60;
  const exp = nowSeconds + expirySeconds;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat, exp, iss: input.appId };

  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(payload),
  )}`;

  let signature: Buffer;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    signature = signer.sign(normalizeGithubPrivateKey(input.privateKeyPem));
  } catch (error) {
    throw new AtlasError(
      "CONFIG_ERROR",
      "Failed to sign GitHub App JWT — check GITHUB_PRIVATE_KEY is a valid PKCS#1/PKCS#8 PEM",
      { statusCode: 500, cause: error },
    );
  }

  return `${signingInput}.${signature.toString("base64url")}`;
}

async function githubAppFetch(
  path: string,
  jwt: string,
  init: { method?: string; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const doFetch = init.fetchImpl ?? fetch;
  return doFetch(`${GITHUB_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
  });
}

export interface InstallationAccessToken {
  readonly token: string;
  /** ISO 8601 expiry timestamp returned by GitHub (~1h from issuance). */
  readonly expiresAt: string;
  readonly repositorySelection: string | null;
  readonly permissions: Readonly<Record<string, string>> | null;
}

/** Exchange an App JWT for a short-lived installation access token. */
export async function exchangeInstallationAccessToken(input: {
  readonly installationId: string;
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly now?: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<InstallationAccessToken> {
  const jwt = signGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  const response = await githubAppFetch(
    `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
    jwt,
    {
      method: "POST",
      ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    },
  );

  if (!response.ok) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      `GitHub installation token exchange failed (${response.status}) for installation ${input.installationId}`,
      { statusCode: 502 },
    );
  }

  const json = (await response.json()) as {
    token: string;
    expires_at: string;
    repository_selection?: string;
    permissions?: Record<string, string>;
  };

  return {
    token: json.token,
    expiresAt: json.expires_at,
    repositorySelection: json.repository_selection ?? null,
    permissions: json.permissions ?? null,
  };
}

export interface GitHubAppInstallationInfo {
  readonly id: number;
  readonly accountLogin: string | null;
  readonly accountType: string | null;
  readonly targetType: string | null;
  readonly repositorySelection: string | null;
  readonly suspendedAt: string | null;
}

/** Confirm an installation exists / is valid via the App-level JWT (GET /app/installations/{id}). */
export async function fetchGitHubAppInstallation(input: {
  readonly installationId: string;
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly now?: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<GitHubAppInstallationInfo> {
  const jwt = signGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  const response = await githubAppFetch(
    `/app/installations/${encodeURIComponent(input.installationId)}`,
    jwt,
    { ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}) },
  );

  if (!response.ok) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      `GitHub installation lookup failed (${response.status}) for installation ${input.installationId}`,
      { statusCode: response.status === 404 ? 404 : 502 },
    );
  }

  const json = (await response.json()) as {
    id: number;
    account: { login?: string | null; type?: string | null } | null;
    target_type?: string | null;
    repository_selection?: string | null;
    suspended_at?: string | null;
  };

  return {
    id: json.id,
    accountLogin: json.account?.login ?? null,
    accountType: json.account?.type ?? null,
    targetType: json.target_type ?? null,
    repositorySelection: json.repository_selection ?? null,
    suspendedAt: json.suspended_at ?? null,
  };
}

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

/**
 * In-memory cache of installation access tokens, keyed by installationId.
 * Refreshes automatically when a cached token is within `refreshBufferMs`
 * of expiry (GitHub installation tokens live ~1h).
 */
export class GitHubAppTokenCache {
  private readonly cache = new Map<string, CachedToken>();

  constructor(
    private readonly config: {
      readonly appId: string;
      readonly privateKeyPem: string;
      readonly fetchImpl?: typeof fetch;
    },
    private readonly refreshBufferMs: number = 60_000,
  ) {}

  async getToken(installationId: string, now: Date = new Date()): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAtMs - now.getTime() > this.refreshBufferMs) {
      return cached.token;
    }

    const result = await exchangeInstallationAccessToken({
      installationId,
      appId: this.config.appId,
      privateKeyPem: this.config.privateKeyPem,
      ...(this.config.fetchImpl !== undefined ? { fetchImpl: this.config.fetchImpl } : {}),
      now,
    });

    this.cache.set(installationId, {
      token: result.token,
      expiresAtMs: new Date(result.expiresAt).getTime(),
    });

    return result.token;
  }

  invalidate(installationId: string): void {
    this.cache.delete(installationId);
  }

  clear(): void {
    this.cache.clear();
  }
}
