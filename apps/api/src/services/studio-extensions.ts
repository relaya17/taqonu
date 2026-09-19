/**
 * Studio extension contract. Manifest + permission registry only.
 *
 * There is no marketplace, no user-supplied JavaScript, and no host API
 * that runs third-party code. Enablement is process-local (not Atlas SoR).
 * Unknown permissions and unimplemented capabilities fail closed.
 */
export const STUDIO_EXTENSION_CONTRACT = {
  marketplace: false,
  userProvidedJs: false,
  hostApi: false,
  isolation: "manifest-only",
  unknownPermission: "deny",
  durableSoR: false,
  /** Deliberate non-goal: Arlet is not an extension marketplace/host. */
  productGoal: false,
} as const;

export const STUDIO_EXTENSION_PERMISSIONS = [
  "workspace.read",
  "terminal.governed",
  "tests.governed",
] as const;

export type StudioExtensionPermission =
  (typeof STUDIO_EXTENSION_PERMISSIONS)[number];

export interface StudioExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly permissions: readonly StudioExtensionPermission[];
  readonly capabilities: readonly string[];
  readonly invocability: "unavailable";
  readonly note: string;
}

export const STUDIO_BUILTIN_EXTENSIONS: readonly StudioExtensionManifest[] = [
  {
    id: "atlas.workspace-inspector",
    name: "Workspace inspector",
    version: "0.1.0",
    permissions: ["workspace.read"],
    capabilities: [],
    invocability: "unavailable",
    note: "First-party tree/search already exist. This manifest does not add a host.",
  },
  {
    id: "atlas.governed-tests",
    name: "Governed tests",
    version: "0.1.0",
    permissions: ["tests.governed"],
    capabilities: [],
    invocability: "unavailable",
    note: "Test execution is the first-party governed test runner, not an extension host.",
  },
] as const;

const ENABLEMENT = new Map<string, Set<string>>();

export function resetStudioExtensionsForTests(): void {
  ENABLEMENT.clear();
}

function keyFor(projectId: string): Set<string> {
  const existing = ENABLEMENT.get(projectId);
  if (existing) return existing;
  const created = new Set<string>();
  ENABLEMENT.set(projectId, created);
  return created;
}

export function getStudioExtension(id: string): StudioExtensionManifest | null {
  return STUDIO_BUILTIN_EXTENSIONS.find((item) => item.id === id) ?? null;
}

export function listStudioExtensions(projectId: string): Array<
  StudioExtensionManifest & { enabled: boolean; hostReady: false }
> {
  const enabled = keyFor(projectId);
  return STUDIO_BUILTIN_EXTENSIONS.map((item) => ({
    ...item,
    enabled: enabled.has(item.id),
    hostReady: false as const,
  }));
}

export function setStudioExtensionEnabled(
  projectId: string,
  extensionId: string,
  enabled: boolean,
):
  | { ok: true; extension: StudioExtensionManifest; enabled: boolean; hostReady: false }
  | { ok: false; denial: "UNKNOWN_EXTENSION" } {
  const manifest = getStudioExtension(extensionId);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  const set = keyFor(projectId);
  if (enabled) set.add(extensionId);
  else set.delete(extensionId);
  return { ok: true, extension: manifest, enabled, hostReady: false };
}
