import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Signed, opaque `state` token round-tripped through GitHub's install
 * redirect (`/apps/{slug}/installations/new?state=...`) so the callback can
 * verify the request originated from us and knows which project/locale to
 * return to — GitHub echoes `state` back unmodified on the setup callback.
 */

const DOMAIN = "github_install_state:v1:";

export interface GitHubInstallState {
  readonly projectId: string | null;
  readonly locale: string | null;
  readonly nonce: string;
  readonly issuedAt: number;
}

function encodePayload(payload: GitHubInstallState): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(secret: string, encoded: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}${encoded}`).digest("base64url");
}

export function signGitHubInstallState(input: {
  readonly secret: string;
  readonly projectId?: string | null;
  readonly locale?: string | null;
  readonly now?: Date;
}): string {
  const payload: GitHubInstallState = {
    projectId: input.projectId ?? null,
    locale: input.locale ?? null,
    nonce: randomUUID(),
    issuedAt: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
  const encoded = encodePayload(payload);
  const signature = sign(input.secret, encoded);
  return `${encoded}.${signature}`;
}

export function verifyGitHubInstallState(input: {
  readonly state: string;
  readonly secret: string;
  readonly maxAgeSeconds?: number;
  readonly now?: Date;
}): GitHubInstallState | null {
  const parts = input.state.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSignature] = parts as [string, string];

  const expectedSignature = sign(input.secret, encoded);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  let payload: GitHubInstallState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GitHubInstallState;
  } catch {
    return null;
  }

  const maxAgeSeconds = input.maxAgeSeconds ?? 900; // 15 minutes
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (
    typeof payload.issuedAt !== "number" ||
    nowSeconds - payload.issuedAt > maxAgeSeconds ||
    nowSeconds - payload.issuedAt < -60
  ) {
    return null;
  }

  return payload;
}
