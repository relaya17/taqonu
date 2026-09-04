import { createHash } from "node:crypto";

/** Deterministic UUID v4-shaped id from a seed. Reproducible across runs. */
export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function paddedSeq(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

export function syntheticEntityId(kind: string, seq: number): string {
  return `TEST-${kind.toUpperCase()}-${paddedSeq(seq)}`;
}

export const SYNTHETIC_ID_PREFIX = "TEST-" as const;

export function looksSyntheticId(value: string): boolean {
  return value.startsWith(SYNTHETIC_ID_PREFIX);
}
