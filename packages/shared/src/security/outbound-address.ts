/**
 * R11 — destination address classification for outbound HTTP.
 * Pure (no DNS, no fetch). The Node pin/connect helper consumes this.
 *
 * Private-network destinations are blocked unless the URL origin is exactly
 * one of the configured Atlas origins (ATLAS_API_URL / ATLAS_CONTROL_PLANE_URL).
 * Cloud metadata, link-local, and CGNAT stay blocked even for that exception.
 */

export const OUTBOUND_ADDRESS_CLASSES = [
  "public",
  "loopback",
  "rfc1918",
  "link_local",
  "ula",
  "cgnat",
  "unspecified",
  "multicast",
  "metadata",
  "other_non_global",
] as const;

export type OutboundAddressClass = (typeof OUTBOUND_ADDRESS_CLASSES)[number];

export type OutboundAddressVerdict = "allow_public" | "allow_atlas_internal" | "deny";

export interface ClassifiedAddress {
  readonly address: string;
  readonly family: 4 | 6;
  readonly class: OutboundAddressClass;
  readonly blocked: boolean;
}

const METADATA_V4 = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200"]);
const METADATA_V6 = new Set(["fd00:ec2::254", "fe80::a9fe:a9fe"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = ((n << 8) | octet) >>> 0;
  }
  return n;
}

function inCidrV4(ip: string, base: string, bits: number): boolean {
  const addr = ipv4ToInt(ip);
  const net = ipv4ToInt(base);
  if (addr === null || net === null) return false;
  if (bits <= 0) return true;
  if (bits >= 32) return addr === net;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) === (net & mask);
}

function expandIpv6(ip: string): string | null {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(":")) return null;
  const [head, tail] = raw.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (raw.includes("::")) {
    if (headParts.length + tailParts.length > 8) return null;
    const missing = 8 - headParts.length - tailParts.length;
    const filled = [...headParts, ...Array(missing).fill("0"), ...tailParts];
    if (filled.length !== 8) return null;
    return filled.map((p) => p.padStart(4, "0")).join(":");
  }
  const parts = raw.split(":");
  if (parts.length !== 8) return null;
  return parts.map((p) => p.padStart(4, "0")).join(":");
}

function ipv6ToBigInt(ip: string): bigint | null {
  const expanded = expandIpv6(ip);
  if (!expanded) return null;
  try {
    return BigInt(`0x${expanded.replace(/:/g, "")}`);
  } catch {
    return null;
  }
}

function inCidrV6(ip: string, base: string, bits: number): boolean {
  const addr = ipv6ToBigInt(ip);
  const net = ipv6ToBigInt(base);
  if (addr === null || net === null) return false;
  if (bits <= 0) return true;
  if (bits >= 128) return addr === net;
  const shift = 128n - BigInt(bits);
  return addr >> shift === net >> shift;
}

function dottedIpv4Mapped(ip: string): string | null {
  const match = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return match?.[1] ?? null;
}

function unwrapIpv4Mapped(ip: string): string | null {
  const dotted = dottedIpv4Mapped(ip);
  if (dotted) return dotted;
  const expanded = expandIpv6(ip);
  if (!expanded) return null;
  if (expanded.startsWith("0000:0000:0000:0000:0000:ffff:")) {
    const hi = Number.parseInt(expanded.slice(30, 34), 16);
    const lo = Number.parseInt(expanded.slice(35, 39), 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function unwrapNat64(ip: string): string | null {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return null;
  const wellKnown = ipv6ToBigInt("64:ff9b::");
  if (wellKnown === null) return null;
  if (addr >> 32n !== wellKnown >> 32n) return null;
  const v4 = Number(addr & 0xffffffffn) >>> 0;
  return `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
}

export function normalizeIpLiteral(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (trimmed.startsWith("::ffff:")) {
    const mapped = unwrapIpv4Mapped(trimmed);
    if (mapped) return mapped;
  }
  return trimmed;
}

export function classifyIpAddress(raw: string): ClassifiedAddress {
  const address = normalizeIpLiteral(raw);
  const v4 = ipv4ToInt(address);
  if (v4 !== null) {
    let klass: OutboundAddressClass = "public";
    if (METADATA_V4.has(address) || inCidrV4(address, "169.254.169.254", 32)) {
      klass = "metadata";
    } else if (inCidrV4(address, "127.0.0.0", 8)) {
      klass = "loopback";
    } else if (
      inCidrV4(address, "10.0.0.0", 8) ||
      inCidrV4(address, "172.16.0.0", 12) ||
      inCidrV4(address, "192.168.0.0", 16)
    ) {
      klass = "rfc1918";
    } else if (inCidrV4(address, "169.254.0.0", 16)) {
      klass = "link_local";
    } else if (inCidrV4(address, "100.64.0.0", 10)) {
      klass = "cgnat";
    } else if (inCidrV4(address, "0.0.0.0", 8)) {
      klass = "unspecified";
    } else if (inCidrV4(address, "224.0.0.0", 4)) {
      klass = "multicast";
    }
    return {
      address,
      family: 4,
      class: klass,
      blocked: klass !== "public",
    };
  }

  const mapped = unwrapIpv4Mapped(address);
  if (mapped) return classifyIpAddress(mapped);

  const nat64 = unwrapNat64(address);
  if (nat64) return classifyIpAddress(nat64);

  const expanded = expandIpv6(address);
  if (!expanded) {
    return {
      address,
      family: 6,
      class: "other_non_global",
      blocked: true,
    };
  }

  let klass: OutboundAddressClass = "public";
  if (METADATA_V6.has(address) || inCidrV6(expanded, "fd00:ec2::254", 128)) {
    klass = "metadata";
  } else if (inCidrV6(expanded, "::1", 128)) {
    klass = "loopback";
  } else if (inCidrV6(expanded, "fe80::", 10)) {
    klass = "link_local";
  } else if (inCidrV6(expanded, "fc00::", 7)) {
    klass = "ula";
  } else if (inCidrV6(expanded, "::", 128)) {
    klass = "unspecified";
  } else if (inCidrV6(expanded, "ff00::", 8)) {
    klass = "multicast";
  }

  return {
    address,
    family: 6,
    class: klass,
    blocked: klass !== "public",
  };
}

export function parseOutboundHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("OUTBOUND_URL_INVALID");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OUTBOUND_URL_SCHEME");
  }
  if (parsed.username || parsed.password) {
    throw new Error("OUTBOUND_URL_USERINFO");
  }
  if (!parsed.hostname) {
    throw new Error("OUTBOUND_URL_HOST");
  }
  return parsed;
}

export function configuredAtlasOrigins(
  env: {
    readonly ATLAS_API_URL?: string;
    readonly ATLAS_CONTROL_PLANE_URL?: string;
  } = typeof process !== "undefined" ? process.env : {},
): readonly string[] {
  const origins: string[] = [];
  for (const raw of [env.ATLAS_API_URL, env.ATLAS_CONTROL_PLANE_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      origins.push(new URL(value).origin);
    } catch {
      /* ignore unparseable configured origin */
    }
  }
  return origins;
}

export function isExactAtlasInternalOrigin(
  url: URL,
  env?: {
    readonly ATLAS_API_URL?: string;
    readonly ATLAS_CONTROL_PLANE_URL?: string;
  },
): boolean {
  return configuredAtlasOrigins(env).includes(url.origin);
}

export function verdictForResolvedAddresses(
  url: URL,
  addresses: readonly string[],
  env?: {
    readonly ATLAS_API_URL?: string;
    readonly ATLAS_CONTROL_PLANE_URL?: string;
  },
): {
  readonly verdict: OutboundAddressVerdict;
  readonly classified: readonly ClassifiedAddress[];
  readonly reason: string;
  readonly pin: ClassifiedAddress | null;
} {
  if (addresses.length === 0) {
    return {
      verdict: "deny",
      classified: [],
      reason: "OUTBOUND_DNS_EMPTY",
      pin: null,
    };
  }

  const classified = addresses.map((address) => classifyIpAddress(address));
  const atlasInternal = isExactAtlasInternalOrigin(url, env);
  const hasPublic = classified.some((row) => !row.blocked);
  const blocked = classified.filter((row) => row.blocked);

  if (blocked.some((row) => row.class === "metadata")) {
    return {
      verdict: "deny",
      classified,
      reason: "OUTBOUND_METADATA",
      pin: null,
    };
  }

  if (hasPublic && blocked.length > 0) {
    return {
      verdict: "deny",
      classified,
      reason: "OUTBOUND_MIXED_RESOLUTION",
      pin: null,
    };
  }

  if (hasPublic) {
    const pin = classified.find((row) => !row.blocked) ?? null;
    return {
      verdict: "allow_public",
      classified,
      reason: "OUTBOUND_PUBLIC",
      pin,
    };
  }

  const onlyAtlasPrivate = blocked.every(
    (row) =>
      row.class === "loopback" ||
      row.class === "rfc1918" ||
      row.class === "ula",
  );
  if (atlasInternal && onlyAtlasPrivate) {
    return {
      verdict: "allow_atlas_internal",
      classified,
      reason: "OUTBOUND_ATLAS_INTERNAL",
      pin: classified[0] ?? null,
    };
  }

  return {
    verdict: "deny",
    classified,
    reason: `OUTBOUND_BLOCKED_${blocked[0]?.class ?? "UNKNOWN"}`.toUpperCase(),
    pin: null,
  };
}

export function requireHttpsUnlessAtlasInternal(
  url: URL,
  env?: {
    readonly ATLAS_API_URL?: string;
    readonly ATLAS_CONTROL_PLANE_URL?: string;
  },
): void {
  if (url.protocol === "https:") return;
  if (isExactAtlasInternalOrigin(url, env)) return;
  throw new Error("OUTBOUND_HTTPS_REQUIRED");
}
