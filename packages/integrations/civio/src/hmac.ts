import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CIVIO_NONCE_HEADER,
  CIVIO_SIGNATURE_HEADER,
  CIVIO_TIMESTAMP_HEADER,
} from "@atlas/shared";

export const CIVIO_CONNECTOR_SECRET_MIN_LENGTH = 32;
export const CIVIO_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export function civioConnectorSigningString(
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return `${timestamp}\n${nonce}\n${rawBody}`;
}

export function signCivioConnectorRequest(input: {
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp?: string;
  readonly nonce?: string;
}): {
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
  readonly headers: Record<string, string>;
} {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const signature = createHmac("sha256", input.secret)
    .update(civioConnectorSigningString(timestamp, nonce, input.rawBody), "utf8")
    .digest("hex");
  return {
    timestamp,
    nonce,
    signature,
    headers: {
      [CIVIO_TIMESTAMP_HEADER]: timestamp,
      [CIVIO_NONCE_HEADER]: nonce,
      [CIVIO_SIGNATURE_HEADER]: signature,
    },
  };
}

export function verifyCivioConnectorSignature(input: {
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp: string | null | undefined;
  readonly nonce: string | null | undefined;
  readonly signature: string | null | undefined;
  readonly now?: number;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!input.secret || input.secret.length < CIVIO_CONNECTOR_SECRET_MIN_LENGTH) {
    return { ok: false, reason: "Civio connector secret is not configured" };
  }
  if (!input.timestamp || !input.nonce || !input.signature) {
    return { ok: false, reason: "Civio connector HMAC headers are required" };
  }
  if (!/^[0-9]+$/.test(input.timestamp)) {
    return { ok: false, reason: "Civio connector timestamp is invalid" };
  }
  if (!/^[0-9a-f]{16,64}$/i.test(input.nonce)) {
    return { ok: false, reason: "Civio connector nonce is invalid" };
  }
  const ts = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > CIVIO_SIGNATURE_MAX_SKEW_MS) {
    return { ok: false, reason: "Civio connector timestamp is outside the replay window" };
  }
  const expected = createHmac("sha256", input.secret)
    .update(
      civioConnectorSigningString(input.timestamp, input.nonce, input.rawBody),
      "utf8",
    )
    .digest("hex");
  const left = Buffer.from(input.signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "Civio connector signature is invalid" };
  }
  return { ok: true };
}
