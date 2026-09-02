import { createHash } from "node:crypto";
import {
  HASH_ALGORITHM,
  canonicalizeJson,
  createArtifactManifest,
  type ArtifactManifestEntry,
} from "./canonicalization.js";

export function sha256Hex(value: string | Uint8Array): string {
  return createHash(HASH_ALGORITHM).update(value).digest("hex");
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

export function hashArtifactManifest(entries: readonly ArtifactManifestEntry[]): string {
  return hashCanonicalJson(createArtifactManifest(entries));
}

export function hashArtifactBytes(content: Uint8Array): string {
  return sha256Hex(content);
}
