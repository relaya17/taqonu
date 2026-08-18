import { beforeEach, describe, expect, it } from "vitest";
import type { PluginManifest } from "@atlas/shared";
import {
  getPlugin,
  listPlugins,
  registerPlugin,
  resetPluginRegistryForTests,
  setPluginStatus,
  validatePluginManifest,
} from "./plugin-registry.js";

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "acme-crm-connector",
    name: "Acme CRM Connector",
    version: "1.0.0",
    description: "Syncs customer records with Acme CRM.",
    author: "Acme Inc.",
    declaredTools: ["memory.search"],
    declaredCapabilities: ["READ_EVIDENCE"],
    declaredEntityActions: [{ entityType: "CUSTOMER", action: "READ" }],
    riskLevel: "LOW",
    status: "PENDING_REVIEW",
    ...overrides,
  } as PluginManifest;
}

beforeEach(() => {
  resetPluginRegistryForTests();
});

describe("validatePluginManifest", () => {
  it("accepts a well-formed manifest with only real, known tools/entity-actions", () => {
    const result = validatePluginManifest(baseManifest());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.id).toBe("acme-crm-connector");
    }
  });

  it("rejects a manifest declaring an unknown tool, mentioning that tool", () => {
    const result = validatePluginManifest(
      baseManifest({ declaredTools: ["totally.unknown.tool"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("totally.unknown.tool"))).toBe(true);
    }
  });

  it("rejects a manifest declaring an unknown entity/action pair", () => {
    const result = validatePluginManifest(
      baseManifest({
        declaredEntityActions: [{ entityType: "SPACESHIP", action: "LAUNCH" }],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("SPACESHIP.LAUNCH"))).toBe(true);
    }
  });

  it("reports ALL errors when a manifest has multiple simultaneous problems", () => {
    const result = validatePluginManifest(
      baseManifest({
        declaredTools: ["bogus.tool.one", "bogus.tool.two"],
        declaredEntityActions: [{ entityType: "NOPE", action: "READ" }],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.some((e) => e.includes("bogus.tool.one"))).toBe(true);
      expect(result.errors.some((e) => e.includes("bogus.tool.two"))).toBe(true);
      expect(result.errors.some((e) => e.includes("NOPE.READ"))).toBe(true);
    }
  });

  it("rejects a shape-invalid manifest (bad id) via the zod parse step", () => {
    const result = validatePluginManifest(baseManifest({ id: "NOT_KEBAB_CASE" }));
    expect(result.valid).toBe(false);
  });
});

describe("registerPlugin", () => {
  it("registers a valid manifest as PENDING_REVIEW", () => {
    const result = registerPlugin(baseManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.status).toBe("PENDING_REVIEW");
      expect(result.plugin.id).toBe("acme-crm-connector");
    }
    expect(getPlugin("acme-crm-connector")?.status).toBe("PENDING_REVIEW");
  });

  it("forces status back to PENDING_REVIEW even if the manifest self-sets ENABLED", () => {
    const result = registerPlugin(baseManifest({ status: "ENABLED" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.status).toBe("PENDING_REVIEW");
    }
  });

  it("forces status back to PENDING_REVIEW even if the manifest self-sets APPROVED", () => {
    const result = registerPlugin(baseManifest({ status: "APPROVED" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.status).toBe("PENDING_REVIEW");
    }
  });

  it("rejects registration of an invalid manifest without registering it", () => {
    const result = registerPlugin(baseManifest({ declaredTools: ["nope.tool"] }));
    expect(result.ok).toBe(false);
    expect(getPlugin("acme-crm-connector")).toBeUndefined();
  });

  it("rejects registering the same id twice, without overwriting the original", () => {
    const first = registerPlugin(baseManifest());
    expect(first.ok).toBe(true);

    const second = registerPlugin(
      baseManifest({ name: "A completely different plugin" }),
    );
    expect(second.ok).toBe(false);

    // Original registration is untouched.
    expect(getPlugin("acme-crm-connector")?.name).toBe("Acme CRM Connector");
  });
});

describe("setPluginStatus", () => {
  it("fails cleanly for an unknown plugin id", () => {
    const result = setPluginStatus("does-not-exist", "APPROVED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("does-not-exist");
    }
  });

  it("updates status for a known plugin", () => {
    registerPlugin(baseManifest());
    const result = setPluginStatus("acme-crm-connector", "APPROVED");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.status).toBe("APPROVED");
    }
  });
});

describe("listPlugins", () => {
  it("filters by status", () => {
    registerPlugin(baseManifest({ id: "plugin-one" }));
    registerPlugin(baseManifest({ id: "plugin-two" }));
    setPluginStatus("plugin-one", "APPROVED");

    expect(listPlugins("PENDING_REVIEW").map((p) => p.id)).toEqual(["plugin-two"]);
    expect(listPlugins("APPROVED").map((p) => p.id)).toEqual(["plugin-one"]);
    expect(listPlugins().length).toBe(2);
  });
});

describe("full realistic lifecycle", () => {
  it("register -> PENDING_REVIEW -> APPROVED -> ENABLED, verified at each step", () => {
    const registered = registerPlugin(baseManifest({ id: "lifecycle-plugin" }));
    expect(registered.ok).toBe(true);
    expect(getPlugin("lifecycle-plugin")?.status).toBe("PENDING_REVIEW");
    expect(listPlugins("PENDING_REVIEW").map((p) => p.id)).toContain("lifecycle-plugin");

    const approved = setPluginStatus("lifecycle-plugin", "APPROVED");
    expect(approved.ok).toBe(true);
    expect(getPlugin("lifecycle-plugin")?.status).toBe("APPROVED");
    expect(listPlugins("APPROVED").map((p) => p.id)).toContain("lifecycle-plugin");
    expect(listPlugins("PENDING_REVIEW").map((p) => p.id)).not.toContain("lifecycle-plugin");

    const enabled = setPluginStatus("lifecycle-plugin", "ENABLED");
    expect(enabled.ok).toBe(true);
    expect(getPlugin("lifecycle-plugin")?.status).toBe("ENABLED");
    expect(listPlugins("ENABLED").map((p) => p.id)).toContain("lifecycle-plugin");
    expect(listPlugins("APPROVED").map((p) => p.id)).not.toContain("lifecycle-plugin");
  });
});
