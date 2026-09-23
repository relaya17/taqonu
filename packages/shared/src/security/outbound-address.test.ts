import { describe, expect, it } from "vitest";
import {
  classifyIpAddress,
  isExactAtlasInternalOrigin,
  parseOutboundHttpUrl,
  requireHttpsUnlessAtlasInternal,
  verdictForResolvedAddresses,
} from "./outbound-address.js";

describe("classifyIpAddress", () => {
  it("allows public IPv4 and IPv6", () => {
    expect(classifyIpAddress("1.1.1.1")).toMatchObject({
      class: "public",
      blocked: false,
      family: 4,
    });
    expect(classifyIpAddress("2606:4700:4700::1111")).toMatchObject({
      class: "public",
      blocked: false,
      family: 6,
    });
  });

  it("rejects loopback, RFC1918, link-local, ULA, CGNAT, unspecified, multicast", () => {
    expect(classifyIpAddress("127.0.0.1").class).toBe("loopback");
    expect(classifyIpAddress("10.0.0.5").class).toBe("rfc1918");
    expect(classifyIpAddress("172.16.1.1").class).toBe("rfc1918");
    expect(classifyIpAddress("192.168.1.1").class).toBe("rfc1918");
    expect(classifyIpAddress("169.254.1.1").class).toBe("link_local");
    expect(classifyIpAddress("100.64.0.1").class).toBe("cgnat");
    expect(classifyIpAddress("0.0.0.0").class).toBe("unspecified");
    expect(classifyIpAddress("224.0.0.1").class).toBe("multicast");
    expect(classifyIpAddress("::1").class).toBe("loopback");
    expect(classifyIpAddress("fe80::1").class).toBe("link_local");
    expect(classifyIpAddress("fd12:3456:789a::1").class).toBe("ula");
    expect(classifyIpAddress("ff02::1").class).toBe("multicast");
  });

  it("rejects cloud metadata and IPv4-mapped / DNS64 embeddings of private addresses", () => {
    expect(classifyIpAddress("169.254.169.254").class).toBe("metadata");
    expect(classifyIpAddress("169.254.170.2").class).toBe("metadata");
    expect(classifyIpAddress("::ffff:127.0.0.1").class).toBe("loopback");
    expect(classifyIpAddress("::ffff:192.168.0.1").class).toBe("rfc1918");
    expect(classifyIpAddress("64:ff9b::7f00:1").class).toBe("loopback");
    expect(classifyIpAddress("64:ff9b::a00:1").class).toBe("rfc1918");
  });
});

describe("parseOutboundHttpUrl / atlas_internal origin", () => {
  const env = {
    ATLAS_API_URL: "http://127.0.0.1:4000",
    ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
  };

  it("rejects non-http schemes and userinfo", () => {
    expect(() => parseOutboundHttpUrl("ftp://example.com")).toThrow(
      "OUTBOUND_URL_SCHEME",
    );
    expect(() => parseOutboundHttpUrl("https://user:pass@example.com")).toThrow(
      "OUTBOUND_URL_USERINFO",
    );
  });

  it("allows http only for the exact configured Atlas origins", () => {
    const api = parseOutboundHttpUrl("http://127.0.0.1:4000/api/v1/health");
    expect(isExactAtlasInternalOrigin(api, env)).toBe(true);
    requireHttpsUnlessAtlasInternal(api, env);
    expect(() =>
      requireHttpsUnlessAtlasInternal(parseOutboundHttpUrl("http://example.com"), env),
    ).toThrow("OUTBOUND_HTTPS_REQUIRED");
    expect(
      isExactAtlasInternalOrigin(parseOutboundHttpUrl("http://127.0.0.1:9999"), env),
    ).toBe(false);
  });

  it("does not treat a private hostname as a generic private-network bypass", () => {
    const verdict = verdictForResolvedAddresses(
      parseOutboundHttpUrl("https://intranet.example"),
      ["10.1.2.3"],
      env,
    );
    expect(verdict.verdict).toBe("deny");
    expect(verdict.reason).toBe("OUTBOUND_BLOCKED_RFC1918");
  });

  it("rejects mixed public/private A/AAAA answers", () => {
    const verdict = verdictForResolvedAddresses(
      parseOutboundHttpUrl("https://example.com"),
      ["1.1.1.1", "10.0.0.1"],
    );
    expect(verdict.verdict).toBe("deny");
    expect(verdict.reason).toBe("OUTBOUND_MIXED_RESOLUTION");
  });

  it("allows atlas_internal loopback and pins the resolved address", () => {
    const verdict = verdictForResolvedAddresses(
      parseOutboundHttpUrl("http://127.0.0.1:3100/api/v1/health"),
      ["127.0.0.1"],
      env,
    );
    expect(verdict.verdict).toBe("allow_atlas_internal");
    expect(verdict.pin?.address).toBe("127.0.0.1");
  });

  it("still rejects metadata even if someone configured that origin", () => {
    const poisoned = {
      ATLAS_API_URL: "http://169.254.169.254",
      ATLAS_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    };
    const verdict = verdictForResolvedAddresses(
      parseOutboundHttpUrl("http://169.254.169.254/latest/meta-data"),
      ["169.254.169.254"],
      poisoned,
    );
    expect(verdict.verdict).toBe("deny");
    expect(verdict.reason).toBe("OUTBOUND_METADATA");
  });
});
