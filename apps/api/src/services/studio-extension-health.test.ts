import { describe, expect, it } from "vitest";
import {
  ProbeHttpError,
  capabilityState,
  classifyProbeError,
  countStates,
  evaluateExtensionHealth,
  extensionState,
  type DependencyResult,
  type Probe,
} from "./studio-extension-health.js";
import type { StudioExtensionManifest } from "./studio-extensions.js";

/**
 * Health contract (ADR-026) — pure engine. Uses a synthetic manifest so the
 * engine is proven generic: it knows dependency kinds, not extensions.
 */
function manifest(
  capabilities: StudioExtensionManifest["capabilities"],
  dependencies: StudioExtensionManifest["dependencies"] = [],
): StudioExtensionManifest {
  return {
    id: "synthetic.health-test",
    name: "Synthetic",
    kind: "official",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: [],
    capabilities,
    contributes: { activity: null, commands: [] },
    dependencies,
    routes: [],
  };
}

const cap = (id: string, dependencies: StudioExtensionManifest["capabilities"][number]["dependencies"]) => ({
  id,
  permission: null,
  source: "test",
  dependencies,
});

const dep = (status: DependencyResult["status"], optional = false): DependencyResult => ({
  kind: "k",
  key: null,
  optional,
  status,
  reason: null,
  durationMs: 0,
});

describe("studio extension health engine", () => {
  it("an unregistered dependency kind is NOT_CHECKED / UNKNOWN_DEPENDENCY, never healthy", async () => {
    const health = await evaluateExtensionHealth({
      manifest: manifest([cap("c1", [{ kind: "synthetic.never-registered" }])]),
      projectId: "p",
      probes: new Map(),
    });
    expect(health.capabilities[0]).toMatchObject({
      status: "NOT_CHECKED",
      dependencies: [{ kind: "synthetic.never-registered", status: "NOT_CHECKED", reason: "UNKNOWN_DEPENDENCY" }],
    });
    expect(health.status).toBe("NOT_CHECKED");
  });

  it("capability rules, in order (contract §E)", () => {
    expect(capabilityState([dep("OK"), dep("OK")])).toBe("HEALTHY");
    for (const s of ["MISSING", "NOT_CONFIGURED", "UNREACHABLE", "ERROR"] as const) {
      expect(capabilityState([dep("OK"), dep(s)])).toBe("UNAVAILABLE");
      // A confirmed failure wins over an indeterminate one.
      expect(capabilityState([dep("TIMEOUT"), dep(s)])).toBe("UNAVAILABLE");
    }
    // Insufficient evidence is not a confirmed failure.
    for (const s of ["TIMEOUT", "RATE_LIMITED", "NOT_CHECKED"] as const) {
      expect(capabilityState([dep("OK"), dep(s)])).toBe("NOT_CHECKED");
    }
    expect(capabilityState([dep("OK"), dep("UNREACHABLE", true)])).toBe("DEGRADED");
    expect(capabilityState([dep("OK"), dep("TIMEOUT", true)])).toBe("DEGRADED");
    expect(capabilityState([dep("TIMEOUT"), dep("MISSING", true)])).toBe("NOT_CHECKED");
    expect(capabilityState([])).toBe("HEALTHY");
  });

  it("extension aggregation keeps partial availability and is not 'worst wins' (contract §F)", () => {
    const of = (...states: Array<"HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CHECKED">) =>
      extensionState(countStates(states.map((status) => ({ status }))));
    expect(of("HEALTHY", "HEALTHY")).toBe("HEALTHY");
    expect(of("UNAVAILABLE", "UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(of("HEALTHY", "UNAVAILABLE")).toBe("DEGRADED");
    expect(of("HEALTHY", "NOT_CHECKED")).toBe("DEGRADED");
    expect(of("DEGRADED", "DEGRADED")).toBe("DEGRADED");
    expect(of("NOT_CHECKED", "NOT_CHECKED")).toBe("NOT_CHECKED");
    expect(of("UNAVAILABLE", "NOT_CHECKED")).toBe("NOT_CHECKED");
    expect(of()).toBe("NOT_CHECKED");
    expect(countStates([{ status: "HEALTHY" }, { status: "UNAVAILABLE" }, { status: "NOT_CHECKED" }])).toEqual({
      healthy: 1,
      degraded: 0,
      unavailable: 1,
      notChecked: 1,
      total: 3,
    });
  });

  it("classifies errors deterministically: UNREACHABLE vs ERROR vs TIMEOUT vs RATE_LIMITED", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(classifyProbeError(refused).status).toBe("UNREACHABLE");
    expect(classifyProbeError(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })).status).toBe(
      "UNREACHABLE",
    );
    expect(classifyProbeError(new ProbeHttpError(0, "no response")).status).toBe("UNREACHABLE");
    expect(classifyProbeError(new ProbeHttpError(503, "unavailable")).status).toBe("UNREACHABLE");
    expect(classifyProbeError(new ProbeHttpError(429, "slow down"))).toEqual({
      status: "RATE_LIMITED",
      reason: "HTTP_429",
    });
    expect(classifyProbeError(new ProbeHttpError(400, "bad query")).status).toBe("ERROR");
    expect(classifyProbeError(new ProbeHttpError(500, "boom")).status).toBe("ERROR");
    expect(classifyProbeError(new Error("parse failure")).status).toBe("ERROR");
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    expect(classifyProbeError(timeout).status).toBe("TIMEOUT");
  });

  it("a slow probe times out → TIMEOUT → capability NOT_CHECKED; a 429 is not an outage", async () => {
    const slow: Probe = (ctx) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve({ status: "OK" }), 500);
        ctx.signal.addEventListener("abort", () => clearTimeout(t));
      });
    const limited: Probe = () => {
      throw new ProbeHttpError(429, "Too Many Requests");
    };
    const ok: Probe = () => ({ status: "OK" });
    const health = await evaluateExtensionHealth({
      manifest: manifest([
        cap("slow", [{ kind: "t.slow" }]),
        cap("limited", [{ kind: "t.limited" }]),
        cap("fine", [{ kind: "t.ok" }]),
      ]),
      projectId: "p",
      probes: new Map([
        ["t.slow", slow],
        ["t.limited", limited],
        ["t.ok", ok],
      ]),
      timeoutMs: 30,
    });
    const byId = Object.fromEntries(health.capabilities.map((c) => [c.id, c]));
    expect(byId.slow!.dependencies[0]).toMatchObject({ status: "TIMEOUT" });
    expect(byId.slow!.status).toBe("NOT_CHECKED");
    expect(byId.limited!.dependencies[0]).toMatchObject({ status: "RATE_LIMITED" });
    expect(byId.limited!.status).toBe("NOT_CHECKED");
    expect(byId.fine!.status).toBe("HEALTHY");
    expect(health.status).toBe("DEGRADED");
    expect(health.counts).toEqual({ healthy: 1, degraded: 0, unavailable: 0, notChecked: 2, total: 3 });
  });

  it("probes may only return OK / MISSING / NOT_CONFIGURED; anything else is ERROR", async () => {
    const liar = (() => ({ status: "UNREACHABLE" })) as unknown as Probe;
    const health = await evaluateExtensionHealth({
      manifest: manifest([cap("c", [{ kind: "t.liar" }])]),
      projectId: "p",
      probes: new Map([["t.liar", liar]]),
    });
    expect(health.capabilities[0]!.dependencies[0]).toMatchObject({ status: "ERROR", reason: "INVALID_PROBE_RESULT" });
  });

  it("merges manifest-level dependencies into every capability", async () => {
    const seen: string[] = [];
    const probe: Probe = (ctx) => {
      seen.push(`${ctx.capabilityId}:${ctx.dependency.kind}`);
      return { status: "OK" };
    };
    await evaluateExtensionHealth({
      manifest: manifest([cap("a", [{ kind: "t.own" }]), cap("b", [])], [{ kind: "t.shared" }]),
      projectId: "p",
      probes: new Map([
        ["t.own", probe],
        ["t.shared", probe],
      ]),
    });
    expect(seen.sort()).toEqual(["a:t.own", "a:t.shared", "b:t.shared"]);
  });
});
