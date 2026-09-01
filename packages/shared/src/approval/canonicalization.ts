import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "atlas-c14n-json/v1" as const;
export const HASH_ALGORITHM = "sha256" as const;

export type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson };

export type ArtifactManifestEntry = Readonly<{
  path: string;
  contentHash: string;
  mode: string;
}>;

export type ArtifactManifestV1 = Readonly<{
  schemaVersion: "atlas-artifact-manifest/v1";
  entries: readonly ArtifactManifestEntry[];
}>;

function fail(message: string): never {
  throw new TypeError(`Invalid ${CANONICALIZATION_VERSION} value: ${message}`);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("strings must not contain unpaired surrogates");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("strings must not contain unpaired surrogates");
    }
  }
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index];
    const rightPoint = rightPoints[index];
    if (leftPoint === undefined || rightPoint === undefined) break;
    const difference = leftPoint.codePointAt(0)! - rightPoint.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalizeValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail("numbers must be finite and not -0");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("cyclic array");
    seen.add(value);
    const result = `[${value.map((item) => canonicalizeValue(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (!isPlainObject(value)) fail("objects must be plain objects");
    if (seen.has(value)) fail("cyclic object");
    seen.add(value);
    const entries = Object.keys(value).sort(compareCodePoints).map((key) => {
      assertUnicodeScalarString(key);
      const entryValue = value[key];
      if (entryValue === undefined) fail(`undefined value for key ${JSON.stringify(key)}`);
      return `${JSON.stringify(key)}:${canonicalizeValue(entryValue, seen)}`;
    });
    seen.delete(value);
    return `{${entries.join(",")}}`;
  }
  fail(`unsupported ${typeof value}`);
}

export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value, new Set<object>());
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash(HASH_ALGORITHM).update(value).digest("hex");
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

function validateManifestPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError("Invalid artifact manifest path");
  }
}

function validateContentHash(contentHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new TypeError("Invalid artifact content hash");
}

export function createArtifactManifest(entries: readonly ArtifactManifestEntry[]): ArtifactManifestV1 {
  const normalized = entries.map((entry) => {
    validateManifestPath(entry.path);
    validateContentHash(entry.contentHash);
    if (!entry.mode) throw new TypeError("Invalid artifact manifest mode");
    return { path: entry.path, contentHash: entry.contentHash, mode: entry.mode };
  }).sort((left, right) => compareCodePoints(left.path, right.path));

  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) {
    throw new TypeError("Artifact manifest paths must be unique");
  }
  return { schemaVersion: "atlas-artifact-manifest/v1", entries: normalized };
}

export function hashArtifactManifest(entries: readonly ArtifactManifestEntry[]): string {
  return hashCanonicalJson(createArtifactManifest(entries));
}

export function hashArtifactBytes(content: Uint8Array): string {
  return sha256Hex(content);
}
