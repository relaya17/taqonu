import { beforeEach, describe, expect, it } from "vitest";
import type { PluginManifest } from "@atlas/shared";
import {
  getPlugin,
  registerPlugin,
  resetPluginRegistryForTests,
} from "./plugin-registry.js";
import {
  approvePlugin,
  disablePlugin,
  enablePlugin,
  rejectPlugin,
  uninstallPlugin,
} from "./plugin-lifecycle.js";

/**
 * Well-formed test manifest. `declaredTools` and `declaredEntityActions`
 * use only real, known values so `registerPlugin` actually succeeds:
 *   - "github.getRepository" is a real `DEFAULT_TOOL_POLICIES` entry
 *     (`packages/agent-core/src/policies/tool-policies.ts`).
 *   - `{ entityType: "RECORD", action: "READ" }` is a real
 *     `DEFAULT_ENTITY_POLICIES` entry
 *     (`packages/agent-core/src/policies/entity-policies.ts`).
 */
function buildManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "A sample plugin used for lifecycle tests.",
    author: "Test Author",
    declaredTools: ["github.getRepository"],
    declaredCapabilities: ["READ_REPO"],
    declaredEntityActions: [{ entityType: "RECORD", action: "READ" }],
    riskLevel: "LOW",
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

function registerSample(overrides: Partial<PluginManifest> = {}): PluginManifest {
  const result = registerPlugin(buildManifest(overrides));
  if (!result.ok) {
    throw new Error(`Test setup failed to register plugin: ${result.reason}`);
  }
  return result.plugin;
}

beforeEach(() => {
  resetPluginRegistryForTests();
});

describe("full legal lifecycle", () => {
  it("register -> approve -> enable -> disable -> re-enable -> disable -> uninstall", () => {
    const registered = registerSample();
    expect(registered.status).toBe("PENDING_REVIEW");
    expect(getPlugin("sample-plugin")?.status).toBe("PENDING_REVIEW");

    const approved = approvePlugin("sample-plugin", {
      approvedBy: "admin@example.com",
      reason: "Looks safe, only declares a read-only tool.",
    });
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.plugin.status).toBe("APPROVED");
    expect(getPlugin("sample-plugin")?.status).toBe("APPROVED");

    const enabled = enablePlugin("sample-plugin");
    expect(enabled.ok).toBe(true);
    if (enabled.ok) expect(enabled.plugin.status).toBe("ENABLED");
    expect(getPlugin("sample-plugin")?.status).toBe("ENABLED");

    const disabled = disablePlugin("sample-plugin");
    expect(disabled.ok).toBe(true);
    if (disabled.ok) expect(disabled.plugin.status).toBe("DISABLED");
    expect(getPlugin("sample-plugin")?.status).toBe("DISABLED");

    const reEnabled = enablePlugin("sample-plugin");
    expect(reEnabled.ok).toBe(true);
    if (reEnabled.ok) expect(reEnabled.plugin.status).toBe("ENABLED");
    expect(getPlugin("sample-plugin")?.status).toBe("ENABLED");

    const disabledAgain = disablePlugin("sample-plugin");
    expect(disabledAgain.ok).toBe(true);
    if (disabledAgain.ok) expect(disabledAgain.plugin.status).toBe("DISABLED");
    expect(getPlugin("sample-plugin")?.status).toBe("DISABLED");

    const uninstalled = uninstallPlugin("sample-plugin");
    expect(uninstalled.ok).toBe(true);
  });
});

describe("approvePlugin", () => {
  it("fails for an unregistered plugin", () => {
    const result = approvePlugin("does-not-exist", {
      approvedBy: "admin@example.com",
      reason: "n/a",
    });
    expect(result.ok).toBe(false);
  });

  it("fails when reason is empty", () => {
    registerSample();
    const result = approvePlugin("sample-plugin", { approvedBy: "admin@example.com", reason: "" });
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("PENDING_REVIEW");
  });

  it("fails to approve a plugin twice", () => {
    registerSample();
    const first = approvePlugin("sample-plugin", {
      approvedBy: "admin@example.com",
      reason: "First approval.",
    });
    expect(first.ok).toBe(true);

    const second = approvePlugin("sample-plugin", {
      approvedBy: "admin@example.com",
      reason: "Second approval attempt.",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason.length).toBeGreaterThan(0);
    }
    expect(getPlugin("sample-plugin")?.status).toBe("APPROVED");
  });

  it("fails to approve after rejection", () => {
    registerSample();
    const rejected = rejectPlugin("sample-plugin", {
      rejectedBy: "admin@example.com",
      reason: "Declares too broad a capability set.",
    });
    expect(rejected.ok).toBe(true);

    const approveAfterReject = approvePlugin("sample-plugin", {
      approvedBy: "admin@example.com",
      reason: "Trying to approve anyway.",
    });
    expect(approveAfterReject.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("REJECTED");
  });
});

describe("rejectPlugin", () => {
  it("fails when reason is empty", () => {
    registerSample();
    const result = rejectPlugin("sample-plugin", { rejectedBy: "admin@example.com", reason: "   " });
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("PENDING_REVIEW");
  });

  it("fails to reject an already-approved plugin", () => {
    registerSample();
    approvePlugin("sample-plugin", { approvedBy: "admin@example.com", reason: "Approved." });

    const result = rejectPlugin("sample-plugin", {
      rejectedBy: "admin@example.com",
      reason: "Trying to reject after approval.",
    });
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("APPROVED");
  });
});

describe("enablePlugin", () => {
  it("fails before approval (still PENDING_REVIEW)", () => {
    registerSample();
    const result = enablePlugin("sample-plugin");
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("PENDING_REVIEW");
  });

  it("fails for a rejected plugin", () => {
    registerSample();
    rejectPlugin("sample-plugin", { rejectedBy: "admin@example.com", reason: "Rejected." });
    const result = enablePlugin("sample-plugin");
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("REJECTED");
  });

  it("fails for an unregistered plugin", () => {
    const result = enablePlugin("does-not-exist");
    expect(result.ok).toBe(false);
  });
});

describe("disablePlugin", () => {
  it("fails for a plugin that was never enabled", () => {
    registerSample();
    approvePlugin("sample-plugin", { approvedBy: "admin@example.com", reason: "Approved." });
    const result = disablePlugin("sample-plugin");
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("APPROVED");
  });

  it("fails for a plugin still PENDING_REVIEW", () => {
    registerSample();
    const result = disablePlugin("sample-plugin");
    expect(result.ok).toBe(false);
  });
});

describe("uninstallPlugin", () => {
  it("fails to uninstall a still-enabled plugin", () => {
    registerSample();
    approvePlugin("sample-plugin", { approvedBy: "admin@example.com", reason: "Approved." });
    enablePlugin("sample-plugin");

    const result = uninstallPlugin("sample-plugin");
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("ENABLED");
  });

  it("fails to uninstall a plugin still PENDING_REVIEW", () => {
    registerSample();
    const result = uninstallPlugin("sample-plugin");
    expect(result.ok).toBe(false);
  });

  it("fails to uninstall a still-approved (not yet enabled) plugin", () => {
    registerSample();
    approvePlugin("sample-plugin", { approvedBy: "admin@example.com", reason: "Approved." });
    const result = uninstallPlugin("sample-plugin");
    expect(result.ok).toBe(false);
    expect(getPlugin("sample-plugin")?.status).toBe("APPROVED");
  });

  it("succeeds for a rejected plugin", () => {
    registerSample();
    rejectPlugin("sample-plugin", { rejectedBy: "admin@example.com", reason: "Rejected." });
    const result = uninstallPlugin("sample-plugin");
    expect(result.ok).toBe(true);
  });

  it("fails for an unregistered plugin", () => {
    const result = uninstallPlugin("does-not-exist");
    expect(result.ok).toBe(false);
  });
});
