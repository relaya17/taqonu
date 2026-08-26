/**
 * Control Plane request hygiene — headers, correlation, rate limit, idempotency.
 *
 * Not a second auth engine. Bearer auth stays in control-plane-auth.ts.
 * CSRF is N/A: this API is Bearer, not cookie-session.
 */
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const CONTROL_PLANE_SECURE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

const RATE_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 120;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

interface RateBucket {
  count: number;
  resetAt: number;
}

interface IdempotentRecord {
  bodyHash: string;
  status: number;
  body: unknown;
  storedAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
const idempotentStore = new Map<string, IdempotentRecord>();
let maxPerWindow = DEFAULT_MAX_PER_WINDOW;

export function resolveRequestId(req: IncomingMessage): string {
  const raw = req.headers["x-request-id"];
  const presented = Array.isArray(raw) ? raw[0] : raw;
  if (typeof presented === "string" && presented.trim().length > 0) {
    return presented.trim().slice(0, 128);
  }
  return randomUUID();
}

export function applyControlPlaneSecurityHeaders(
  res: ServerResponse,
  requestId: string,
): void {
  for (const [name, value] of Object.entries(CONTROL_PLANE_SECURE_HEADERS)) {
    res.setHeader(name, value);
  }
  res.setHeader("X-Request-Id", requestId);
}

export function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

export function checkRateLimit(req: IncomingMessage, now = Date.now()): {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
} {
  const key = clientKey(req);
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  existing.count += 1;
  if (existing.count > maxPerWindow) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function hashIdempotencyBody(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type IdempotencyLookup =
  | { readonly kind: "fresh" }
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown }
  | { readonly kind: "conflict" };

export function lookupIdempotency(
  key: string | null | undefined,
  bodyHash: string,
  now = Date.now(),
): IdempotencyLookup {
  if (!key || key.trim().length === 0) return { kind: "fresh" };
  const normalized = key.trim().slice(0, 256);
  const existing = idempotentStore.get(normalized);
  if (!existing) return { kind: "fresh" };
  if (now - existing.storedAt > IDEMPOTENCY_TTL_MS) {
    idempotentStore.delete(normalized);
    return { kind: "fresh" };
  }
  if (existing.bodyHash !== bodyHash) return { kind: "conflict" };
  return { kind: "replay", status: existing.status, body: existing.body };
}

export function storeIdempotentResponse(
  key: string | null | undefined,
  bodyHash: string,
  status: number,
  body: unknown,
  now = Date.now(),
): void {
  if (!key || key.trim().length === 0) return;
  idempotentStore.set(key.trim().slice(0, 256), {
    bodyHash,
    status,
    body,
    storedAt: now,
  });
}

export function resetControlPlaneHardeningForTests(): void {
  rateBuckets.clear();
  idempotentStore.clear();
  maxPerWindow = DEFAULT_MAX_PER_WINDOW;
}

export function setRateLimitMaxForTests(max: number): void {
  maxPerWindow = max;
}
