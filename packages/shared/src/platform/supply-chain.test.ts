import { describe, expect, it } from "vitest";
import { verifySupplyChainArtifacts } from "./supply-chain.js";

const VALID_SBOM = JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  components: [{ name: "@atlas/shared", version: "0.1.0" }],
});

describe("verifySupplyChainArtifacts", () => {
  it("reports missing SBOM and never claims a signed release", () => {
    const result = verifySupplyChainArtifacts({});
    expect(result.sbom).toBe("MISSING");
    expect(result.signing).toBe("UNSIGNED");
    expect(result.releaseReady).toBe(false);
  });

  it("accepts a parseable CycloneDX SBOM as VALID while remaining UNSIGNED", () => {
    const result = verifySupplyChainArtifacts({ sbomJson: VALID_SBOM });
    expect(result.sbom).toBe("VALID");
    expect(result.signing).toBe("UNSIGNED");
    expect(result.releaseReady).toBe(false);
  });

  it("rejects garbage SBOM JSON", () => {
    const result = verifySupplyChainArtifacts({ sbomJson: "{not-json" });
    expect(result.sbom).toBe("INVALID");
    expect(result.releaseReady).toBe(false);
  });

  it("fail-closes a signature blob without a signing identity", () => {
    const result = verifySupplyChainArtifacts({
      sbomJson: VALID_SBOM,
      signaturePresent: true,
    });
    expect(result.signing).toBe("INVALID");
    expect(result.releaseReady).toBe(false);
    expect(result.evidence).toMatch(/unset/i);
  });

  it("does not fake VERIFIED when identity is set but no verifier exists", () => {
    const result = verifySupplyChainArtifacts({
      sbomJson: VALID_SBOM,
      signaturePresent: true,
      signingIdentity: "https://github.com/relaya17/taqonu-main/.github/workflows/ci.yml@refs/heads/main",
    });
    expect(result.signing).toBe("INVALID");
    expect(result.releaseReady).toBe(false);
    expect(result.evidence).toMatch(/Do not fake VERIFIED/);
  });
});
