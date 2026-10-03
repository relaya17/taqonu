/**
 * Studio extensions — ADR-026 (Arlet, 2026-10-03).
 *
 * Native ArletOS extensions: declarative manifests, compiled into the API,
 * that connect capabilities ArletOS already has to the Studio workbench (an
 * activity-bar icon, a panel, commands). Built-in (Git, Tests) and official
 * extensions only. No third-party extensions, no user-provided JavaScript,
 * no VS Code / VSIX hosting and no extension code running on the server.
 *
 * Scope (durable, osStore → cloud store):
 * - user:    installed extensions + versions, granted permissions
 * - project: enabled extensions, activity-bar order, view state, verification
 *
 * Installing grants nothing. Requests made on behalf of an extension carry
 * `x-arletos-extension`; `authorizeStudioExtensionRequest` enforces that the
 * route is declared by the manifest and its permission is granted.
 * Unknown extensions, permissions and routes fail closed.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { osStore } from "../store/os-store.js";
import type {
  StoredStudioExtensionInstall,
  StoredStudioExtensionProjectState,
} from "../store/os-store.js";

export const STUDIO_EXTENSION_CONTRACT = {
  /** Official ArletOS catalog only — not a marketplace of outside publishers. */
  marketplace: "official-only",
  thirdParty: false,
  userProvidedJs: false,
  serverSideExtensionCode: false,
  vsCodeCompatibility: false,
  /** Extensions contribute declaratively (icon, panel, commands); no code host. */
  hostApi: "declarative-contributions",
  isolation: "manifest-only",
  unknownPermission: "deny",
  installGrantsPermissions: false,
  permissionEnforcement: "api",
  durableSoR: true,
  productGoal: true,
  adr: "ADR-026",
} as const;

/** Studio version extensions declare compatibility against. */
export const STUDIO_VERSION = "2.0.0";

export const STUDIO_EXTENSION_PERMISSIONS = [
  "workspace.read",
  "terminal.governed",
  "tests.governed",
  "git.read",
  "qa.run",
  "qa.learn",
  "security.scan",
  "observer.run",
  "cloud.read",
  "deploy.observe",
  "agent.runs.read",
  "agent.runs.approve",
] as const;

export type StudioExtensionPermission = (typeof STUDIO_EXTENSION_PERMISSIONS)[number];

export type StudioExtensionKind = "builtin" | "official";
export type StudioExtensionRequirement = "workspace" | "git-repo";

export interface StudioExtensionRoute {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Fastify route pattern exactly as registered (e.g. `/api/v1/projects/:id/sentinel`). */
  readonly url: string;
  /** Permission the user must have granted; null = harmless read with no grant needed. */
  readonly permission: StudioExtensionPermission | null;
  /** When set, the JSON body's `commandId` must be one of these. */
  readonly commandIds?: readonly string[];
}

export interface StudioExtensionCapability {
  readonly id: string;
  readonly permission: StudioExtensionPermission | null;
  /** Where it lives in the code — shown in the catalog so nothing is a mock-up. */
  readonly source: string;
}

export interface StudioExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly kind: StudioExtensionKind;
  readonly publisher: "arletos";
  readonly version: string;
  /** Minimum Studio version (semver). */
  readonly studio: string;
  readonly permissions: readonly StudioExtensionPermission[];
  readonly capabilities: readonly StudioExtensionCapability[];
  readonly contributes: {
    readonly activity: { readonly icon: string; readonly panel: string } | null;
    readonly commands: readonly string[];
  };
  readonly requires: readonly StudioExtensionRequirement[];
  readonly routes: readonly StudioExtensionRoute[];
}

const GIT_READ_COMMANDS = ["git.status", "git.branch", "git.diff", "git.log", "git.blame"] as const;

export const STUDIO_BUILTIN_EXTENSIONS: readonly StudioExtensionManifest[] = [
  {
    id: "arletos.git",
    name: "Git",
    kind: "builtin",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["git.read"],
    capabilities: [
      { id: "git.changes", permission: "git.read", source: "StudioGitStatus · git.status / git.diff" },
      { id: "git.history", permission: "git.read", source: "StudioGitStatus · git.log / git.blame" },
    ],
    contributes: { activity: { icon: "git", panel: "git" }, commands: ["open"] },
    requires: ["workspace", "git-repo"],
    routes: [
      { method: "POST", url: "/api/v1/projects/:id/studio/terminal", permission: "git.read", commandIds: GIT_READ_COMMANDS },
      { method: "POST", url: "/api/v1/projects/:id/studio/terminal/decide-and-execute", permission: "git.read" },
      { method: "GET", url: "/api/v1/projects/:id/studio/executions/last", permission: "git.read" },
    ],
  },
  {
    id: "arletos.tests",
    name: "Tests & QA",
    kind: "builtin",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["qa.run", "qa.learn"],
    capabilities: [
      { id: "qa.runs", permission: "qa.run", source: "QaPanel · /qa/runs" },
      { id: "qa.patterns", permission: "qa.learn", source: "QaPanel · /qa/patterns, /qa/learn" },
    ],
    contributes: { activity: { icon: "tests", panel: "tests" }, commands: ["open"] },
    requires: ["workspace"],
    routes: [
      { method: "GET", url: "/api/v1/projects", permission: null },
      { method: "GET", url: "/api/v1/qa/runs", permission: "qa.run" },
      { method: "POST", url: "/api/v1/qa/runs", permission: "qa.run" },
      { method: "GET", url: "/api/v1/qa/patterns", permission: "qa.learn" },
      { method: "POST", url: "/api/v1/qa/learn", permission: "qa.learn" },
      { method: "DELETE", url: "/api/v1/qa/learn", permission: "qa.learn" },
    ],
  },
  {
    id: "arletos.cloud",
    name: "Cloud & deploy",
    kind: "official",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["cloud.read", "deploy.observe"],
    capabilities: [
      { id: "cloud.adapters", permission: "cloud.read", source: "CloudToolsPanel · /providers/adapters" },
      { id: "cloud.deployments", permission: "cloud.read", source: "DeployFeedsPanel · /feeds/:projectId/deployment" },
      { id: "cloud.observe", permission: "deploy.observe", source: "DeployFeedsPanel · /providers/vercel|render/observe" },
      { id: "cloud.githubSync", permission: "deploy.observe", source: "DeployFeedsPanel · /github/sync" },
    ],
    contributes: { activity: { icon: "cloud", panel: "cloud" }, commands: ["open"] },
    requires: [],
    routes: [
      { method: "GET", url: "/api/v1/providers/adapters", permission: "cloud.read" },
      { method: "GET", url: "/api/v1/feeds/:projectId/deployment", permission: "cloud.read" },
      { method: "POST", url: "/api/v1/providers/vercel/observe", permission: "deploy.observe" },
      { method: "POST", url: "/api/v1/providers/render/observe", permission: "deploy.observe" },
      { method: "POST", url: "/api/v1/github/sync", permission: "deploy.observe" },
    ],
  },
  {
    id: "arletos.security",
    name: "Security",
    kind: "official",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["security.scan"],
    capabilities: [
      { id: "security.scan", permission: "security.scan", source: "SentinelPanel · /projects/:id/sentinel*" },
      { id: "security.sarif", permission: "security.scan", source: "SentinelPanel · /security/sarif" },
    ],
    contributes: { activity: { icon: "security", panel: "security" }, commands: ["open"] },
    requires: ["workspace"],
    routes: [
      { method: "GET", url: "/api/v1/projects/:id/sentinel", permission: "security.scan" },
      { method: "POST", url: "/api/v1/projects/:id/sentinel/scan", permission: "security.scan" },
      { method: "POST", url: "/api/v1/projects/:id/sentinel/propose", permission: "security.scan" },
      { method: "POST", url: "/api/v1/projects/:id/sentinel/verify", permission: "security.scan" },
      { method: "POST", url: "/api/v1/security/sarif", permission: "security.scan" },
    ],
  },
  {
    id: "arletos.observer",
    name: "Observer",
    kind: "official",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["observer.run"],
    capabilities: [
      { id: "observer.cycle", permission: "observer.run", source: "ObserverPanel · /projects/:id/observe-cycle" },
      { id: "observer.history", permission: "observer.run", source: "ObserverPanel · /projects/:id/observer/snapshots" },
    ],
    contributes: { activity: { icon: "observer", panel: "observer" }, commands: ["open"] },
    requires: ["workspace"],
    routes: [
      { method: "GET", url: "/api/v1/projects/:id/observer", permission: "observer.run" },
      { method: "GET", url: "/api/v1/projects/:id/observer/snapshots", permission: "observer.run" },
      { method: "POST", url: "/api/v1/projects/:id/observe-cycle", permission: "observer.run" },
      { method: "POST", url: "/api/v1/observer/bugs", permission: "observer.run" },
    ],
  },
  {
    id: "arletos.agent-runs",
    name: "Engineering runs",
    kind: "official",
    publisher: "arletos",
    version: "1.0.0",
    studio: "2.0.0",
    permissions: ["agent.runs.read", "agent.runs.approve"],
    capabilities: [
      { id: "runs.list", permission: "agent.runs.read", source: "EngineeringRunsPanel · /engineering/loop" },
      { id: "runs.approve", permission: "agent.runs.approve", source: "EngineeringRunsPanel · /engineering/loop/:id/approve" },
    ],
    contributes: { activity: { icon: "runs", panel: "runs" }, commands: ["open"] },
    requires: [],
    routes: [
      { method: "GET", url: "/api/v1/engineering/loop", permission: "agent.runs.read" },
      { method: "GET", url: "/api/v1/engineering/loop/:id", permission: "agent.runs.read" },
      { method: "POST", url: "/api/v1/engineering/loop/:id/approve", permission: "agent.runs.approve" },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// semver (major.minor.patch only — manifests are ours)

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return 0;
}

export function isStudioCompatible(manifest: StudioExtensionManifest, studio = STUDIO_VERSION): boolean {
  return compareVersions(studio, manifest.studio) >= 0;
}

// ---------------------------------------------------------------------------
// registry

export function getStudioExtension(id: string): StudioExtensionManifest | null {
  return STUDIO_BUILTIN_EXTENSIONS.find((item) => item.id === id) ?? null;
}

function isKnownPermission(value: string): value is StudioExtensionPermission {
  return (STUDIO_EXTENSION_PERMISSIONS as readonly string[]).includes(value);
}

export function resetStudioExtensionsForTests(): void {
  // State lives in osStore; tests reset it with osStore.unloadForTests().
}

// ---------------------------------------------------------------------------
// user scope

function installRecordFor(
  userId: string,
  manifest: StudioExtensionManifest,
): StoredStudioExtensionInstall | null {
  const installs = osStore.getStudioExtensionInstalls(userId);
  const record = installs[manifest.id];
  if (record) return record;
  if (manifest.kind === "builtin") {
    // Built-ins ship with ArletOS: installed, but nothing is granted.
    return { version: manifest.version, installedAt: "", updatedAt: "", grants: [] };
  }
  return null;
}

function saveInstall(userId: string, id: string, record: StoredStudioExtensionInstall | null): void {
  const installs = osStore.getStudioExtensionInstalls(userId);
  if (record) installs[id] = record;
  else delete installs[id];
  osStore.setStudioExtensionInstalls(userId, installs);
}

export type StudioExtensionDenial =
  | "UNKNOWN_EXTENSION"
  | "UNKNOWN_PERMISSION"
  | "BUILTIN_CANNOT_UNINSTALL"
  | "NOT_INSTALLED"
  | "ALREADY_INSTALLED"
  | "INCOMPATIBLE"
  | "NO_UPDATE"
  | "PERMISSION_NOT_DECLARED";

export type StudioExtensionResult<T> = { ok: true; value: T } | { ok: false; denial: StudioExtensionDenial };

export function installStudioExtension(userId: string, id: string): StudioExtensionResult<StoredStudioExtensionInstall> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  if (!isStudioCompatible(manifest)) return { ok: false, denial: "INCOMPATIBLE" };
  const existing = osStore.getStudioExtensionInstalls(userId)[id];
  if (existing || manifest.kind === "builtin") return { ok: false, denial: "ALREADY_INSTALLED" };
  const now = new Date().toISOString();
  const record: StoredStudioExtensionInstall = { version: manifest.version, installedAt: now, updatedAt: now, grants: [] };
  saveInstall(userId, id, record);
  return { ok: true, value: record };
}

export function uninstallStudioExtension(userId: string, id: string): StudioExtensionResult<null> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  if (manifest.kind === "builtin") return { ok: false, denial: "BUILTIN_CANNOT_UNINSTALL" };
  if (!osStore.getStudioExtensionInstalls(userId)[id]) return { ok: false, denial: "NOT_INSTALLED" };
  // Permissions and settings go with it.
  saveInstall(userId, id, null);
  return { ok: true, value: null };
}

export function updateStudioExtension(userId: string, id: string): StudioExtensionResult<StoredStudioExtensionInstall> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  if (!isStudioCompatible(manifest)) return { ok: false, denial: "INCOMPATIBLE" };
  const current = installRecordFor(userId, manifest);
  if (!current) return { ok: false, denial: "NOT_INSTALLED" };
  if (compareVersions(current.version, manifest.version) >= 0) return { ok: false, denial: "NO_UPDATE" };
  const now = new Date().toISOString();
  // Grants are kept; permissions the new version adds stay pending.
  const record: StoredStudioExtensionInstall = {
    ...current,
    version: manifest.version,
    installedAt: current.installedAt || now,
    updatedAt: now,
    grants: current.grants.filter((p) => manifest.permissions.includes(p as StudioExtensionPermission)),
  };
  saveInstall(userId, id, record);
  return { ok: true, value: record };
}

export function setStudioExtensionGrants(
  userId: string,
  id: string,
  change: { grant: readonly string[]; revoke: readonly string[] },
): StudioExtensionResult<StoredStudioExtensionInstall> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  for (const permission of [...change.grant, ...change.revoke]) {
    if (!isKnownPermission(permission)) return { ok: false, denial: "UNKNOWN_PERMISSION" };
    if (!manifest.permissions.includes(permission)) return { ok: false, denial: "PERMISSION_NOT_DECLARED" };
  }
  const current = installRecordFor(userId, manifest);
  if (!current) return { ok: false, denial: "NOT_INSTALLED" };
  const grants = new Set(current.grants);
  for (const p of change.grant) grants.add(p);
  for (const p of change.revoke) grants.delete(p);
  const now = new Date().toISOString();
  const record: StoredStudioExtensionInstall = {
    ...current,
    installedAt: current.installedAt || now,
    updatedAt: now,
    grants: [...grants].sort(),
  };
  saveInstall(userId, id, record);
  return { ok: true, value: record };
}

// ---------------------------------------------------------------------------
// project scope

function defaultEnabled(manifest: StudioExtensionManifest): boolean {
  return manifest.kind === "builtin";
}

export function setStudioExtensionEnabled(
  userId: string,
  projectId: string,
  id: string,
  enabled: boolean,
): StudioExtensionResult<{ enabled: boolean }> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  if (enabled && !installRecordFor(userId, manifest)) return { ok: false, denial: "NOT_INSTALLED" };
  if (enabled && !isStudioCompatible(manifest)) return { ok: false, denial: "INCOMPATIBLE" };
  const state = osStore.getStudioExtensionProject(projectId);
  state.enabled[id] = enabled;
  if (enabled && !state.order.includes(id)) state.order.push(id);
  osStore.setStudioExtensionProject(projectId, state);
  return { ok: true, value: { enabled } };
}

export function setStudioExtensionOrder(projectId: string, order: readonly string[]): StudioExtensionResult<string[]> {
  for (const id of order) {
    if (!getStudioExtension(id)) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  }
  const state = osStore.getStudioExtensionProject(projectId);
  state.order = [...new Set(order)];
  osStore.setStudioExtensionProject(projectId, state);
  return { ok: true, value: state.order };
}

export function setStudioExtensionView(projectId: string, view: Record<string, unknown>): void {
  const state = osStore.getStudioExtensionProject(projectId);
  state.view = view;
  osStore.setStudioExtensionProject(projectId, state);
}

function isEnabledIn(state: StoredStudioExtensionProjectState, manifest: StudioExtensionManifest): boolean {
  return state.enabled[manifest.id] ?? defaultEnabled(manifest);
}

/** Verification: do the extension's prerequisites hold in this project? */
export function verifyStudioExtension(
  projectId: string,
  id: string,
): StudioExtensionResult<StoredStudioExtensionProjectState["verified"][string]> {
  const manifest = getStudioExtension(id);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  const root = osStore.getWorkspaceRoot(projectId);
  const hasWorkspace = Boolean(root && existsSync(root));
  const checks = manifest.requires.map((requirement) => {
    if (requirement === "workspace") {
      return { id: "workspace", ok: hasWorkspace, reason: hasWorkspace ? null : "NO_LOCAL_FOLDER" };
    }
    const gitDir = root ? join(root, ".git") : "";
    const hasGit = Boolean(hasWorkspace && gitDir && existsSync(gitDir) && statSync(gitDir).isDirectory());
    return { id: "git-repo", ok: hasGit, reason: hasGit ? null : "NO_GIT_REPOSITORY" };
  });
  if (!isStudioCompatible(manifest)) {
    checks.push({ id: "compatibility", ok: false, reason: "INCOMPATIBLE" });
  }
  const result = { at: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
  const state = osStore.getStudioExtensionProject(projectId);
  state.verified[id] = result;
  osStore.setStudioExtensionProject(projectId, state);
  return { ok: true, value: result };
}

// ---------------------------------------------------------------------------
// views

export interface StudioExtensionView {
  readonly manifest: StudioExtensionManifest;
  readonly compatible: boolean;
  readonly installed: boolean;
  readonly installedVersion: string | null;
  readonly updateAvailable: boolean;
  readonly granted: string[];
  readonly pendingPermissions: string[];
}

export function listStudioExtensionCatalog(userId: string): StudioExtensionView[] {
  return STUDIO_BUILTIN_EXTENSIONS.map((manifest) => {
    const record = installRecordFor(userId, manifest);
    const granted = record ? record.grants.filter((p) => manifest.permissions.includes(p as StudioExtensionPermission)) : [];
    return {
      manifest,
      compatible: isStudioCompatible(manifest),
      installed: Boolean(record),
      installedVersion: record?.version ?? null,
      updateAvailable: Boolean(record && compareVersions(record.version, manifest.version) < 0),
      granted,
      pendingPermissions: record ? manifest.permissions.filter((p) => !granted.includes(p)) : [...manifest.permissions],
    };
  });
}

export function listStudioExtensions(userId: string, projectId: string) {
  const state = osStore.getStudioExtensionProject(projectId);
  const catalog = listStudioExtensionCatalog(userId);
  const ordered = [
    ...state.order.filter((id) => catalog.some((c) => c.manifest.id === id)),
    ...catalog.map((c) => c.manifest.id).filter((id) => !state.order.includes(id)),
  ];
  return {
    order: ordered,
    view: state.view,
    extensions: catalog.map((entry) => ({
      ...entry,
      enabled: entry.installed && entry.compatible && isEnabledIn(state, entry.manifest),
      verification: state.verified[entry.manifest.id] ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// enforcement (x-arletos-extension)

export type StudioExtensionRequestDenial =
  | "UNKNOWN_EXTENSION"
  | "INCOMPATIBLE"
  | "NOT_INSTALLED"
  | "NOT_ENABLED"
  | "NO_PROJECT"
  | "ROUTE_NOT_DECLARED"
  | "COMMAND_NOT_DECLARED"
  | "PERMISSION_NOT_GRANTED";

export function authorizeStudioExtensionRequest(input: {
  readonly userId: string;
  readonly extensionId: string;
  readonly projectId: string | null;
  readonly method: string;
  readonly url: string;
  readonly commandId: string | null;
}): { ok: true; permission: StudioExtensionPermission | null } | { ok: false; denial: StudioExtensionRequestDenial } {
  const manifest = getStudioExtension(input.extensionId);
  if (!manifest) return { ok: false, denial: "UNKNOWN_EXTENSION" };
  if (!isStudioCompatible(manifest)) return { ok: false, denial: "INCOMPATIBLE" };
  const record = installRecordFor(input.userId, manifest);
  if (!record) return { ok: false, denial: "NOT_INSTALLED" };
  const route = manifest.routes.find(
    (r) => r.method === input.method.toUpperCase() && r.url === input.url,
  );
  if (!route) return { ok: false, denial: "ROUTE_NOT_DECLARED" };
  if (route.commandIds && !(input.commandId && route.commandIds.includes(input.commandId))) {
    return { ok: false, denial: "COMMAND_NOT_DECLARED" };
  }
  // Extensions act inside a project; the project must have it enabled.
  if (!input.projectId) return { ok: false, denial: "NO_PROJECT" };
  if (!isEnabledIn(osStore.getStudioExtensionProject(input.projectId), manifest)) {
    return { ok: false, denial: "NOT_ENABLED" };
  }
  if (route.permission && !record.grants.includes(route.permission)) {
    return { ok: false, denial: "PERMISSION_NOT_GRANTED" };
  }
  return { ok: true, permission: route.permission };
}
