import { createHmac, timingSafeEqual } from "node:crypto";
import {
  APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH,
  APPLICATION_PREFLIGHT_SIGNATURE_MAX_SKEW_MS,
  ATLAS_CONNECTOR_NONCE_HEADER,
  ATLAS_CONNECTOR_SIGNATURE_HEADER,
  ATLAS_CONNECTOR_TIMESTAMP_HEADER,
  CIVIO_NONCE_HEADER,
  CIVIO_SIGNATURE_HEADER,
  CIVIO_TIMESTAMP_HEADER,
  applicationConnectorSigningString,
} from "@atlas/shared";

export function headerString(
  headers: { readonly [name: string]: string | string[] | undefined },
  name: string,
): string | null {
  const raw = name
    ? (headers[name] ?? headers[name.toLowerCase()])
    : undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

export function readApplicationConnectorHmacHeaders(headers: {
  readonly [name: string]: string | string[] | undefined;
}): {
  readonly timestamp: string | null;
  readonly nonce: string | null;
  readonly signature: string | null;
} {
  return {
    timestamp:
      headerString(headers, ATLAS_CONNECTOR_TIMESTAMP_HEADER) ??
      headerString(headers, CIVIO_TIMESTAMP_HEADER),
    nonce:
      headerString(headers, ATLAS_CONNECTOR_NONCE_HEADER) ??
      headerString(headers, CIVIO_NONCE_HEADER),
    signature:
      headerString(headers, ATLAS_CONNECTOR_SIGNATURE_HEADER) ??
      headerString(headers, CIVIO_SIGNATURE_HEADER),
  };
}

export function verifyApplicationConnectorSignature(input: {
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp: string | null | undefined;
  readonly nonce: string | null | undefined;
  readonly signature: string | null | undefined;
  readonly now?: number;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (
    !input.secret ||
    input.secret.length < APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH
  ) {
    return { ok: false, reason: "Application connector secret is not configured" };
  }
  if (!input.timestamp || !input.nonce || !input.signature) {
    return { ok: false, reason: "Application connector HMAC headers are required" };
  }
  if (!/^[0-9]+$/.test(input.timestamp)) {
    return { ok: false, reason: "Application connector timestamp is invalid" };
  }
  if (!/^[0-9a-f]{16,64}$/i.test(input.nonce)) {
    return { ok: false, reason: "Application connector nonce is invalid" };
  }
  const ts = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(ts) ||
    Math.abs(now - ts) > APPLICATION_PREFLIGHT_SIGNATURE_MAX_SKEW_MS
  ) {
    return {
      ok: false,
      reason: "Application connector timestamp is outside the replay window",
    };
  }
  const expected = createHmac("sha256", input.secret)
    .update(
      applicationConnectorSigningString(input.timestamp, input.nonce, input.rawBody),
      "utf8",
    )
    .digest("hex");
  const left = Buffer.from(input.signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "Application connector signature is invalid" };
  }
  return { ok: true };
}
