import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CANONICALIZATION_VERSION,
  canonicalizeJson,
  createArtifactManifest,
} from "../index.js";
import {
  createExecutionApprovalEnvelope,
  hashArtifactBytes,
  hashArtifactManifest,
  hashCanonicalJson,
  matchExecutionCandidate,
  validateExecutionApprovalEnvelope,
  type ExecutionCandidate,
} from "../node.js";

const HASH_A = "a".repeat(64);

function candidate(overrides: Partial<ExecutionCandidate> = {}): ExecutionCandidate {
  return {
    schemaVersion: "atlas.execution-approval-envelope/v1",
    approvalId: "11111111-1111-4111-8111-111111111111",
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requester: { principalId: "requester-1", principalType: "USER", tenantId: "tenant-1" },
    proposedExecutingAgent: { agentId: "CODE_ENGINEER", identityVersion: "catalog/v1" },
    operation: "request_agent_run",
    action: "READ",
    tool: { name: "analyze_repo", catalogVersion: "catalog/v1", argumentSchemaVersion: "args/v1" },
    toolArgs: { query: "Unicode: cafe \u0000\u0001", flags: [true, 2] },
    toolArgsHash: HASH_A,
    entity: { type: "DOCUMENT", id: null },
    project: { projectId: "project-1" },
    tenant: { tenantId: "tenant-1" },
    artifact: { artifactId: null, artifactHash: null, hashAlgorithm: null, canonicalizationVersion: null },
    verificationPlan: {
      version: "verification/v1",
      expectedObservations: ["found file", "reported output"],
      baselineObservations: [],
      verificationPlanHash: HASH_A,
    },
    policyDecision: {
      policyVersion: "policy/v1",
      riskLevel: "HIGH",
      disposition: "REQUIRES_APPROVAL",
      decisionHash: HASH_A,
    },
    requestedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
}

function candidateWithoutHash(envelope: ReturnType<typeof createExecutionApprovalEnvelope>): ExecutionCandidate {
  const { envelopeHash: ignoredEnvelopeHash, ...candidateValue } = envelope;
  void ignoredEnvelopeHash;
  return candidateValue;
}

describe("atlas-c14n-json/v1", () => {
  it("has deterministic golden vectors for object ordering, arrays, Unicode, numbers, and nested values", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalizeJson({ text: "cafe \u0000\u0001" })).toBe(String.raw`{"text":"cafe \u0000\u0001"}`);
    expect(canonicalizeJson({ integer: 1, decimal: 1.5, zero: 0 })).toBe('{"decimal":1.5,"integer":1,"zero":0}');
    expect(canonicalizeJson({ emptyObject: {}, emptyArray: [], nested: { z: [true, null, "x"] } })).toBe('{"emptyArray":[],"emptyObject":{},"nested":{"z":[true,null,"x"]}}');
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  });

  it("rejects unsupported values, cycles, and invalid numbers without repairing them", () => {
    expect(() => canonicalizeJson(undefined)).toThrow(/unsupported undefined/);
    expect(() => canonicalizeJson({ value: undefined })).toThrow(/undefined value/);
    expect(() => canonicalizeJson(() => "x")).toThrow(/unsupported function/);
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/finite/);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => canonicalizeJson(-0)).toThrow(/not -0/);
    expect(() => canonicalizeJson(String.fromCharCode(0xd800))).toThrow(/unpaired surrogates/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow(/cyclic/);
  });
});

describe("artifact hashing", () => {
  it("hashes exact bytes and canonical sorted manifests", () => {
    expect(hashArtifactBytes(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const entries = [
      { path: "src/b.ts", contentHash: "b".repeat(64), mode: "100644" },
      { path: "src/a.ts", contentHash: "a".repeat(64), mode: "100644" },
    ];
    expect(createArtifactManifest(entries).entries.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(hashArtifactManifest(entries)).toBe(hashArtifactManifest([...entries].reverse()));
  });

  it("rejects invalid artifact manifest paths, hashes, modes, and duplicates", () => {
    expect(() => createArtifactManifest([{ path: "../secret", contentHash: HASH_A, mode: "100644" }])).toThrow();
    expect(() => createArtifactManifest([{ path: "src\\a.ts", contentHash: HASH_A, mode: "100644" }])).toThrow();
    expect(() => createArtifactManifest([{ path: "src/a.ts", contentHash: "not-a-hash", mode: "100644" }])).toThrow();
    expect(() => createArtifactManifest([{ path: "src/a.ts", contentHash: HASH_A, mode: "" }])).toThrow();
    expect(() => createArtifactManifest([
      { path: "src/a.ts", contentHash: HASH_A, mode: "100644" },
      { path: "src/a.ts", contentHash: "b".repeat(64), mode: "100644" },
    ])).toThrow(/unique/);
  });
});

describe("ExecutionApprovalEnvelopeV1", () => {
  it("creates, verifies, and exactly matches a canonical immutable envelope", () => {
    const source = candidate();
    const envelope = createExecutionApprovalEnvelope(source);
    expect(envelope.toolArgsHash).toBe(hashCanonicalJson(source.toolArgs));
    expect(envelope.verificationPlan.verificationPlanHash).toBe(hashCanonicalJson({
      version: source.verificationPlan.version,
      expectedObservations: source.verificationPlan.expectedObservations,
      baselineObservations: source.verificationPlan.baselineObservations,
    }));
    expect(envelope.envelopeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(matchExecutionCandidate(envelope, candidateWithoutHash(envelope))).toEqual({ matched: true });
  });

  it("fails closed when one tool argument or verification plan field changes", () => {
    const envelope = createExecutionApprovalEnvelope(candidate());
    const changedArgs = { ...candidateWithoutHash(envelope), toolArgs: { query: "different", flags: [true, 2] } };
    const changedPlan = {
      ...candidateWithoutHash(envelope),
      verificationPlan: { ...envelope.verificationPlan, expectedObservations: ["different"] },
    };
    expect(matchExecutionCandidate(envelope, changedArgs)).toEqual({ matched: false, field: "envelopeHash" });
    expect(matchExecutionCandidate(envelope, changedPlan)).toEqual({ matched: false, field: "envelopeHash" });
  });

  it("rejects version, hash, required-field, and nullable-artifact semantic failures", () => {
    const envelope = createExecutionApprovalEnvelope(candidate());
    expect(() =>
      validateExecutionApprovalEnvelope({
        ...envelope,
        canonicalizationVersion: "atlas-c14n-json/v0",
      }),
    ).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ schemaVersion: "atlas.execution-approval-envelope/v0" as "atlas.execution-approval-envelope/v1" }))).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ requester: { principalId: "", principalType: "USER", tenantId: "tenant-1" } }))).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ artifact: { artifactId: "artifact-1", artifactHash: null, hashAlgorithm: null, canonicalizationVersion: null } }))).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ expiresAt: "2026-09-01T00:00:00.000Z" }))).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ tenant: { tenantId: "tenant-2" } }))).toThrow();
    expect(() => createExecutionApprovalEnvelope(candidate({ toolArgs: { missing: true } }), z.object({ query: z.string() }).strict())).toThrow();
    expect(() => {
      const forged = { ...envelope, toolArgsHash: HASH_A };
      return matchExecutionCandidate(forged, candidateWithoutHash(envelope));
    }).toThrow(/toolArgsHash/);
  });
});
