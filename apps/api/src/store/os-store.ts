import { resolve } from "node:path";
import { findRepoRoot } from "../services/repo-root.js";
import type {
  Claim,
  Decision,
  EvidenceRecord,
  Memory,
  Project,
  ProjectStateSnapshot,
  Artifact,
  AssistRun,
  AgentRun,
  CreditsBalance,
  ContactLead,
  PatchArtifact,
  QualityGateGraph,
  EvalRun,
  DomainEvent,
  EngineeringLoopRun,
  AtlasEvalSuiteRun,
  RegressionReport,
  ProductionReadinessCertificate,
} from "@atlas/shared";
import { parseEvidenceRecord } from "@atlas/shared";
import type { ConnectorObservation } from "@atlas/state";
import type { GitHubRepoObservation } from "@atlas/integrations-github";
import {
  appendAuditLogLine,
  AUDIT_MEMORY_RING,
  resolveAuditLogPath,
} from "../services/audit-log.js";
import { atomicWriteStoreFile, loadJsonWithBackup } from "./store-io.js";

export interface DbFeedObservation {
  readonly provider: "supabase" | "mongodb";
  readonly projectId: string;
  readonly observedAt: string;
  readonly summary: string;
  readonly tableOrCollectionCount: number;
  readonly names: readonly string[];
  readonly rlsEnabled?: boolean | null;
  readonly host?: string | null;
}

export interface DeployFeedObservation {
  readonly provider: "vercel" | "render";
  readonly projectId: string;
  readonly observedAt: string;
  readonly summary: string;
  readonly environment: "production" | "preview" | "development";
  readonly status: string;
  readonly url: string | null;
  readonly commitSha: string | null;
  readonly hostLabel: string;
}

/** Stored secrets — never returned raw via API. */
export interface StoredGithubConnection {
  id: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  login: string | null;
  displayLabel: string | null;
  token: string;
  scopesHint: string | null;
  connectedAt: string | null;
  updatedAt: string;
  lastError: string | null;
}

/** GitHub App installation confirmed via the App-level JWT (GET /app/installations/{id}). */
export interface StoredGithubAppInstallation {
  installationId: string;
  /** Project this installation is linked to, or null for an account-level install. */
  projectId: string | null;
  accountLogin: string | null;
  accountType: string | null;
  targetType: string | null;
  repositorySelection: string | null;
  setupAction: string | null;
  suspendedAt: string | null;
  installedAt: string;
  updatedAt: string;
}

export interface StoredLocalConnection {
  id: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  reposRoot: string | null;
  displayLabel: string | null;
  connectedAt: string | null;
  updatedAt: string;
  lastError: string | null;
  lastScanAt: string | null;
  lastScanRepoCount: number | null;
}

interface PersistedShape {
  projects: Project[];
  evidence: Record<string, EvidenceRecord[]>;
  claims: Record<string, Claim[]>;
  memories: Record<string, Memory[]>;
  decisions: Record<string, Decision[]>;
  snapshots: Record<string, ProjectStateSnapshot>;
  github: Record<string, GitHubRepoObservation>;
  dbFeeds: Record<string, DbFeedObservation[]>;
  deployFeeds: Record<string, DeployFeedObservation[]>;
  openTasks: Record<string, string[]>;
  events: Array<Record<string, unknown>>;
  githubConnection?: StoredGithubConnection | null;
  githubAppInstallations?: Record<string, StoredGithubAppInstallation>;
  localConnection?: StoredLocalConnection | null;
  /** Local project id → cloud row id (ADR-011) */
  cloudLinks?: Record<string, CloudProjectLink>;
  /** Legacy single-instance plan (kept for personal deployments). */
  plan?: StoredPlan | null;
  /** Per-tenant Stripe/freemium subscription state keyed by owner_id. */
  tenantSubscriptions?: Record<string, StoredTenantSubscription>;
  artifacts?: Artifact[];
  assistRuns?: AssistRun[];
  credits?: CreditsBalance | null;
  conflictResolutions?: Record<string, string>;
  audit?: Array<Record<string, unknown>>;
  /** Recent agent run summaries (ring); durable trail also in audit.ndjson. */
  agentRuns?: AgentRun[];
  contactLeads?: ContactLead[];
  patches?: PatchArtifact[];
  gateGraphs?: QualityGateGraph[];
  evalRuns?: EvalRun[];
  usageMeters?: UsageMeters;
  loopRuns?: EngineeringLoopRun[];
  evalSuites?: AtlasEvalSuiteRun[];
  regressionReports?: RegressionReport[];
  readinessCertificates?: ProductionReadinessCertificate[];
  meta?: Record<string, string>;
  /** Local absolute paths for BYO project roots (explicit permissions). */
  workspaceRoots?: Record<string, string>;
  /** Durable conversation threads (survives API restart). */
  conversationThreads?: Record<string, ConversationThreadTurn[]>;
  /** Customer BYO cloud bindings (Cloudflare-first). Keyed by ownerId. */
  byoCloudBindings?: Record<string, StoredByoCloudBinding>;
}

export interface ConversationThreadTurn {
  role: "user" | "assistant";
  content: string;
  epistemicLabel?: string;
  evidenceRefs?: unknown[];
  at: string;
}

export interface CloudProjectLink {
  cloudProjectId: string;
  syncedAt: string;
}

export interface StoredPlan {
  tier: "free" | "pro";
  updatedAt: string;
}

export type TenantSubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete"
  | "none";

/** Tenant-scoped freemium/Stripe subscription (ADR-011). */
export interface StoredTenantSubscription {
  ownerId: string;
  tier: "free" | "pro";
  status: TenantSubscriptionStatus;
  cloudSlotLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  updatedAt: string;
}

export interface UsageMeters {
  evalRunsByDay: Record<string, number>;
  processAuditsByDay?: Record<string, number>;
  agentMessagesByDay?: Record<string, number>;
  verdictsRequested?: number;
  certificatesIssued?: number;
  reportsGenerated?: number;
  reposConnected?: number;
  designPartnerSessions?: number;
}

export interface StoredByoCloudBinding {
  provider: "cloudflare";
  status: "disconnected" | "connected" | "error";
  accountLabel: string | null;
  externalAccountId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  capabilities: Array<"r2" | "d1" | "kv" | "workers" | "pages">;
  /** Presence only — never persist raw API tokens in store.json (v1). */
  tokenConfigured: boolean;
}


function storePath(): string {
  const fromEnv = process.env.ATLAS_STORE_PATH;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return resolve(findRepoRoot(), ".atlas", "store.json");
}

/** Load primary store, then `.bak`, so a torn write does not wipe state. */
function loadPersistedShape(): PersistedShape | null {
  return loadJsonWithBackup<PersistedShape>(storePath());
}

function emptyShape(): PersistedShape {
  return {
    projects: [],
    evidence: {},
    claims: {},
    memories: {},
    decisions: {},
    snapshots: {},
    github: {},
    dbFeeds: {},
    deployFeeds: {},
    openTasks: {},
    events: [],
    githubConnection: null,
    githubAppInstallations: {},
    localConnection: null,
    cloudLinks: {},
    plan: null,
    tenantSubscriptions: {},
    artifacts: [],
    assistRuns: [],
    credits: null,
    conflictResolutions: {},
    audit: [],
    agentRuns: [],
    contactLeads: [],
    patches: [],
    gateGraphs: [],
    evalRuns: [],
    usageMeters: { evalRunsByDay: {} },
    loopRuns: [],
    evalSuites: [],
    regressionReports: [],
    readinessCertificates: [],
    meta: {},
    workspaceRoots: {},
    conversationThreads: {},
    byoCloudBindings: {},
  };
}

/** Durable OS store: JSON file (local) — Supabase dual-write when configured. */
class OsStore {
  private projects: Project[] = [];
  readonly evidence = new Map<string, EvidenceRecord[]>();
  readonly claims = new Map<string, Claim[]>();
  readonly memories = new Map<string, Memory[]>();
  readonly decisions = new Map<string, Decision[]>();
  readonly observations = new Map<string, ConnectorObservation[]>();
  readonly github = new Map<string, GitHubRepoObservation>();
  readonly dbFeeds = new Map<string, DbFeedObservation[]>();
  readonly deployFeeds = new Map<string, DeployFeedObservation[]>();
  readonly snapshots = new Map<string, ProjectStateSnapshot>();
  readonly openTasks = new Map<string, string[]>();
  events: Array<Record<string, unknown>> = [];
  private githubConnection: StoredGithubConnection | null = null;
  private githubAppInstallations = new Map<string, StoredGithubAppInstallation>();
  private localConnection: StoredLocalConnection | null = null;
  private cloudLinks = new Map<string, CloudProjectLink>();
  private plan: StoredPlan | null = null;
  private tenantSubscriptions = new Map<string, StoredTenantSubscription>();
  private artifacts: Artifact[] = [];
  private assistRuns: AssistRun[] = [];
  private credits: CreditsBalance | null = null;
  private conflictResolutions = new Map<string, string>();
  private audit: Array<Record<string, unknown>> = [];
  private agentRuns: AgentRun[] = [];
  private contactLeads: ContactLead[] = [];
  private patches: PatchArtifact[] = [];
  private gateGraphs: QualityGateGraph[] = [];
  private evalRuns: EvalRun[] = [];
  private usageMeters: UsageMeters = { evalRunsByDay: {} };
  private loopRuns: EngineeringLoopRun[] = [];
  private evalSuites: AtlasEvalSuiteRun[] = [];
  private regressionReports: RegressionReport[] = [];
  private readinessCertificates: ProductionReadinessCertificate[] = [];
  private meta: Record<string, string> = {};
  private workspaceRoots: Record<string, string> = {};
  private conversationThreads = new Map<string, ConversationThreadTurn[]>();
  private byoCloudBindings = new Map<string, StoredByoCloudBinding>();
  private loaded = false;

  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const raw = loadPersistedShape();
    if (!raw) {
      return;
    }
    this.applyShape(raw);
  }

  /** True when local disk has no critical domain rows (safe to hydrate from cloud). */
  isEssentiallyEmpty(): boolean {
    this.ensureLoaded();
    const memoryCount = [...this.memories.values()].reduce((n, list) => n + list.length, 0);
    const decisionCount = [...this.decisions.values()].reduce((n, list) => n + list.length, 0);
    return (
      this.projects.length === 0 &&
      memoryCount === 0 &&
      decisionCount === 0 &&
      this.tenantSubscriptions.size === 0
    );
  }

  private applyShape(raw: PersistedShape): void {
    this.projects = raw.projects ?? [];
    for (const [k, v] of Object.entries(raw.evidence ?? {})) {
      this.evidence.set(
        k,
        (v ?? []).map((item) => parseEvidenceRecord(item)),
      );
    }
    for (const [k, v] of Object.entries(raw.claims ?? {})) {
      this.claims.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.memories ?? {})) {
      this.memories.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.decisions ?? {})) {
      this.decisions.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.snapshots ?? {})) {
      this.snapshots.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.github ?? {})) {
      this.github.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.dbFeeds ?? {})) {
      this.dbFeeds.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.deployFeeds ?? {})) {
      this.deployFeeds.set(k, v);
    }
    const observationProjectIds = new Set([
      ...this.github.keys(),
      ...this.dbFeeds.keys(),
      ...this.deployFeeds.keys(),
    ]);
    for (const projectId of observationProjectIds) {
      this.rebuildObservations(projectId);
    }
    for (const [k, v] of Object.entries(raw.openTasks ?? {})) {
      this.openTasks.set(k, v);
    }
    this.events = raw.events ?? [];
    this.githubConnection = raw.githubConnection ?? null;
    this.githubAppInstallations = new Map(
      Object.entries(raw.githubAppInstallations ?? {}),
    );
    this.localConnection = raw.localConnection ?? null;
    this.cloudLinks = new Map(Object.entries(raw.cloudLinks ?? {}));
    this.plan = raw.plan ?? null;
    this.tenantSubscriptions = new Map(
      Object.entries(raw.tenantSubscriptions ?? {}),
    );
    this.artifacts = raw.artifacts ?? [];
    this.assistRuns = raw.assistRuns ?? [];
    this.credits = raw.credits ?? null;
    this.conflictResolutions = new Map(
      Object.entries(raw.conflictResolutions ?? {}),
    );
    this.audit = raw.audit ?? [];
    this.agentRuns = raw.agentRuns ?? [];
    this.contactLeads = raw.contactLeads ?? [];
    this.patches = raw.patches ?? [];
    this.gateGraphs = raw.gateGraphs ?? [];
    this.evalRuns = raw.evalRuns ?? [];
    this.usageMeters = raw.usageMeters ?? { evalRunsByDay: {} };
    this.loopRuns = raw.loopRuns ?? [];
    this.evalSuites = raw.evalSuites ?? [];
    this.regressionReports = raw.regressionReports ?? [];
    this.readinessCertificates = raw.readinessCertificates ?? [];
    this.meta = raw.meta ?? {};
    this.workspaceRoots = raw.workspaceRoots ?? {};
    this.conversationThreads = new Map(
      Object.entries(raw.conversationThreads ?? {}),
    );
    this.byoCloudBindings = new Map(Object.entries(raw.byoCloudBindings ?? {}));
  }

  persist(): void {
    this.ensureLoaded();
    if (process.env.ATLAS_SKIP_STORE_PERSIST === "1") {
      return;
    }
    const path = storePath();
    const shape: PersistedShape = {
      projects: this.projects,
      evidence: Object.fromEntries(this.evidence),
      claims: Object.fromEntries(this.claims),
      memories: Object.fromEntries(this.memories),
      decisions: Object.fromEntries(this.decisions),
      snapshots: Object.fromEntries(this.snapshots),
      github: Object.fromEntries(this.github),
      dbFeeds: Object.fromEntries(this.dbFeeds),
      deployFeeds: Object.fromEntries(this.deployFeeds),
      openTasks: Object.fromEntries(this.openTasks),
      events: this.events.slice(-500),
      githubConnection: this.githubConnection,
      githubAppInstallations: Object.fromEntries(this.githubAppInstallations),
      localConnection: this.localConnection,
      cloudLinks: Object.fromEntries(this.cloudLinks),
      plan: this.plan,
      tenantSubscriptions: Object.fromEntries(this.tenantSubscriptions),
      artifacts: this.artifacts,
      assistRuns: this.assistRuns.slice(-200),
      credits: this.credits,
      conflictResolutions: Object.fromEntries(this.conflictResolutions),
      audit: this.audit.slice(-AUDIT_MEMORY_RING),
      agentRuns: this.agentRuns.slice(-200),
      contactLeads: this.contactLeads.slice(-500),
      patches: this.patches.slice(-200),
      gateGraphs: this.gateGraphs.slice(-50),
      evalRuns: this.evalRuns.slice(-100),
      usageMeters: this.usageMeters,
      loopRuns: this.loopRuns.slice(-100),
      evalSuites: this.evalSuites.slice(-50),
      regressionReports: this.regressionReports.slice(-50),
      readinessCertificates: this.readinessCertificates.slice(-50),
      meta: this.meta,
      workspaceRoots: this.workspaceRoots,
      conversationThreads: Object.fromEntries(this.conversationThreads),
      byoCloudBindings: Object.fromEntries(this.byoCloudBindings),
    };
    atomicWriteStoreFile(path, JSON.stringify(shape, null, 2));
  }

  getGithubConnection(): StoredGithubConnection | null {
    this.ensureLoaded();
    return this.githubConnection;
  }

  setGithubConnection(connection: StoredGithubConnection | null): void {
    this.ensureLoaded();
    this.githubConnection = connection;
    this.persist();
  }

  upsertGithubAppInstallation(
    installation: StoredGithubAppInstallation,
  ): StoredGithubAppInstallation {
    this.ensureLoaded();
    this.githubAppInstallations.set(installation.installationId, installation);
    this.persist();
    return installation;
  }

  getGithubAppInstallation(installationId: string): StoredGithubAppInstallation | undefined {
    this.ensureLoaded();
    return this.githubAppInstallations.get(installationId);
  }

  listGithubAppInstallations(): readonly StoredGithubAppInstallation[] {
    this.ensureLoaded();
    return [...this.githubAppInstallations.values()];
  }

  getGithubAppInstallationForProject(
    projectId: string,
  ): StoredGithubAppInstallation | undefined {
    this.ensureLoaded();
    return [...this.githubAppInstallations.values()].find(
      (item) => item.projectId === projectId,
    );
  }

  getLocalConnection(): StoredLocalConnection | null {
    this.ensureLoaded();
    return this.localConnection;
  }

  setLocalConnection(connection: StoredLocalConnection | null): void {
    this.ensureLoaded();
    this.localConnection = connection;
    this.persist();
  }

  getPlan(): StoredPlan | null {
    this.ensureLoaded();
    return this.plan;
  }

  setPlan(plan: StoredPlan): void {
    this.ensureLoaded();
    this.plan = plan;
    this.persist();
  }

  getTenantSubscription(ownerId: string): StoredTenantSubscription | null {
    this.ensureLoaded();
    return this.tenantSubscriptions.get(ownerId) ?? null;
  }

  findTenantByStripeCustomerId(
    customerId: string,
  ): StoredTenantSubscription | null {
    this.ensureLoaded();
    for (const sub of this.tenantSubscriptions.values()) {
      if (sub.stripeCustomerId === customerId) return sub;
    }
    return null;
  }

  setTenantSubscription(sub: StoredTenantSubscription): void {
    this.ensureLoaded();
    this.tenantSubscriptions.set(sub.ownerId, sub);
    // Keep legacy single-plan mirror for personal-instance callers.
    this.plan = { tier: sub.tier, updatedAt: sub.updatedAt };
    this.persist();
  }

  /**
   * Move a tenant subscription from one owner id to another (OAuth id
   * reconciliation). No-op when `fromId` has no row or ids match.
   */
  rekeyTenantOwner(fromId: string, toId: string): boolean {
    this.ensureLoaded();
    if (!fromId || !toId || fromId === toId) return false;
    const existing = this.tenantSubscriptions.get(fromId);
    if (!existing) return false;
    this.tenantSubscriptions.delete(fromId);
    const next: StoredTenantSubscription = {
      ...existing,
      ownerId: toId,
      updatedAt: new Date().toISOString(),
    };
    // Prefer keeping the destination row if one already exists (rare).
    if (!this.tenantSubscriptions.has(toId)) {
      this.tenantSubscriptions.set(toId, next);
    }
    this.persist();
    return true;
  }

  /** Test helper — clear billing fields without touching the rest of the store. */
  resetBillingStateForTests(): void {
    this.ensureLoaded();
    this.plan = null;
    this.tenantSubscriptions.clear();
    for (const key of Object.keys(this.meta)) {
      if (key.startsWith("stripe.")) {
        delete this.meta[key];
      }
    }
  }

  /**
   * Test-only: clear in-memory state and force the next ensureLoaded() to
   * re-read store.json (simulates process restart for agentRuns / audit ring).
   */
  unloadForTests(): void {
    this.projects = [];
    this.evidence.clear();
    this.claims.clear();
    this.memories.clear();
    this.decisions.clear();
    this.observations.clear();
    this.github.clear();
    this.dbFeeds.clear();
    this.deployFeeds.clear();
    this.snapshots.clear();
    this.openTasks.clear();
    this.events = [];
    this.githubConnection = null;
    this.githubAppInstallations.clear();
    this.localConnection = null;
    this.cloudLinks.clear();
    this.plan = null;
    this.tenantSubscriptions.clear();
    this.artifacts = [];
    this.assistRuns = [];
    this.credits = null;
    this.conflictResolutions.clear();
    this.audit = [];
    this.agentRuns = [];
    this.contactLeads = [];
    this.patches = [];
    this.gateGraphs = [];
    this.evalRuns = [];
    this.usageMeters = { evalRunsByDay: {} };
    this.loopRuns = [];
    this.evalSuites = [];
    this.regressionReports = [];
    this.readinessCertificates = [];
    this.meta = {};
    this.workspaceRoots = {};
    this.loaded = false;
  }

  getCloudLink(projectId: string): CloudProjectLink | undefined {
    this.ensureLoaded();
    return this.cloudLinks.get(projectId);
  }

  listCloudLinks(): ReadonlyMap<string, CloudProjectLink> {
    this.ensureLoaded();
    return this.cloudLinks;
  }

  setCloudLink(projectId: string, link: CloudProjectLink): void {
    this.ensureLoaded();
    this.cloudLinks.set(projectId, link);
    this.persist();
  }

  countCloudLinkedProjects(): number {
    this.ensureLoaded();
    return this.cloudLinks.size;
  }

  listProjects(): readonly Project[] {
    this.ensureLoaded();
    return this.projects;
  }

  getProject(id: string): Project | undefined {
    this.ensureLoaded();
    return this.projects.find((item) => item.id === id);
  }

  getProjectBySlug(slug: string): Project | undefined {
    this.ensureLoaded();
    return this.projects.find((item) => item.slug === slug);
  }

  upsertProject(project: Project): Project {
    this.ensureLoaded();
    const index = this.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) {
      this.projects[index] = project;
    } else {
      const bySlug = this.projects.findIndex((item) => item.slug === project.slug);
      if (bySlug >= 0) {
        this.projects[bySlug] = { ...project, id: this.projects[bySlug]!.id };
        this.persist();
        return this.projects[bySlug]!;
      }
      this.projects.push(project);
    }
    this.persist();
    return project;
  }

  getEvidence(projectId: string): EvidenceRecord[] {
    this.ensureLoaded();
    return (this.evidence.get(projectId) ?? []).map((item) =>
      parseEvidenceRecord(item),
    );
  }

  addEvidence(projectId: string, records: readonly EvidenceRecord[]): void {
    this.ensureLoaded();
    const existing = this.getEvidence(projectId);
    const normalized = records.map((item) => parseEvidenceRecord(item));
    this.evidence.set(projectId, [...existing, ...normalized]);
    this.persist();
  }

  getClaims(projectId: string): Claim[] {
    this.ensureLoaded();
    return this.claims.get(projectId) ?? [];
  }

  getMemories(projectId: string): Memory[] {
    this.ensureLoaded();
    return this.memories.get(projectId) ?? [];
  }

  addMemory(memory: Memory): void {
    this.ensureLoaded();
    const projectId = memory.projectId ?? "global";
    const existing = this.memories.get(projectId) ?? [];
    this.memories.set(projectId, [...existing, memory]);
    this.persist();
  }

  replaceMemories(projectKey: string, memories: Memory[]): void {
    this.ensureLoaded();
    this.memories.set(projectKey, memories);
    this.persist();
  }

  getDecisions(projectId: string): Decision[] {
    this.ensureLoaded();
    return this.decisions.get(projectId) ?? [];
  }

  listDecisions(): Decision[] {
    this.ensureLoaded();
    return [...this.decisions.values()].flat();
  }

  getDecision(id: string): Decision | undefined {
    this.ensureLoaded();
    for (const list of this.decisions.values()) {
      const found = list.find((d) => d.id === id);
      if (found) return found;
    }
    return undefined;
  }

  addDecision(decision: Decision): void {
    this.ensureLoaded();
    const projectId = decision.projectId ?? "global";
    const existing = this.decisions.get(projectId) ?? [];
    this.decisions.set(projectId, [...existing, decision]);
    this.persist();
  }

  updateDecision(decision: Decision): Decision {
    this.ensureLoaded();
    let previousKey: string | null = null;
    for (const [key, list] of this.decisions.entries()) {
      if (list.some((d) => d.id === decision.id)) {
        previousKey = key;
        break;
      }
    }
    if (previousKey === null) {
      throw new Error(`Decision ${decision.id} not found`);
    }
    const nextKey = decision.projectId ?? "global";
    const without = (this.decisions.get(previousKey) ?? []).filter(
      (d) => d.id !== decision.id,
    );
    this.decisions.set(previousKey, without);
    const dest = this.decisions.get(nextKey) ?? [];
    this.decisions.set(nextKey, [...dest, decision]);
    this.persist();
    return decision;
  }

  setGitHubObservation(
    projectId: string,
    observation: GitHubRepoObservation,
  ): void {
    this.ensureLoaded();
    this.github.set(projectId, observation);
    this.rebuildObservations(projectId);
    this.persist();
  }

  setDbFeed(projectId: string, feed: DbFeedObservation): void {
    this.ensureLoaded();
    const existing = (this.dbFeeds.get(projectId) ?? []).filter(
      (item) => item.provider !== feed.provider,
    );
    const next = [...existing, feed];
    this.dbFeeds.set(projectId, next);
    this.rebuildObservations(projectId);
    this.persist();
  }

  setDeployFeed(projectId: string, feed: DeployFeedObservation): void {
    this.ensureLoaded();
    const existing = (this.deployFeeds.get(projectId) ?? []).filter(
      (item) => item.provider !== feed.provider,
    );
    const next = [...existing, feed];
    this.deployFeeds.set(projectId, next);
    this.rebuildObservations(projectId);
    this.persist();
  }

  private rebuildObservations(projectId: string): void {
    const items: ConnectorObservation[] = [];
    const observation = this.github.get(projectId);
    if (observation) {
      items.push({
        connector: "github",
        projectId,
        observedAt: observation.observedAt,
        repository: {
          fullName: observation.fullName,
          defaultBranch: observation.defaultBranch,
          private: observation.private,
          htmlUrl: observation.htmlUrl,
          lastSyncedAt: observation.lastSyncedAt,
        },
        headSha: observation.headSha,
        openPrCount: observation.openPrCount,
        openIssueCount: observation.openIssueCount,
        dependencyManifests: observation.dependencyManifests,
        hasCiConfig: observation.hasCiConfig,
        architectureDocPaths: observation.architectureDocPaths,
        testSignals: {
          hasTestDirectory: observation.hasTestDirectory,
          recentCiStatus: observation.recentCiStatus,
        },
        securitySignals: {
          hasDependabot: observation.hasDependabot,
          hasCodeowners: observation.hasCodeowners,
        },
      });
    }

    for (const feed of this.dbFeeds.get(projectId) ?? []) {
      items.push({
        connector: feed.provider,
        projectId,
        observedAt: feed.observedAt,
        database: {
          provider: feed.provider,
          summary: feed.summary,
          objectCount: feed.tableOrCollectionCount,
          objectNames: feed.names,
          rlsEnabled: feed.rlsEnabled ?? null,
          host: feed.host ?? null,
        },
      });
    }

    for (const feed of this.deployFeeds.get(projectId) ?? []) {
      items.push({
        connector: feed.provider,
        projectId,
        observedAt: feed.observedAt,
        deployment: {
          provider: feed.provider,
          summary: feed.summary,
          environment: feed.environment,
          status: feed.status,
          url: feed.url,
          commitSha: feed.commitSha,
        },
      });
    }

    this.observations.set(projectId, items);
  }

  getObservations(projectId: string): ConnectorObservation[] {
    this.ensureLoaded();
    return this.observations.get(projectId) ?? [];
  }

  setSnapshot(snapshot: ProjectStateSnapshot): void {
    this.ensureLoaded();
    this.snapshots.set(snapshot.projectId, snapshot);
    this.persist();
  }

  getSnapshot(projectId: string): ProjectStateSnapshot | undefined {
    this.ensureLoaded();
    return this.snapshots.get(projectId);
  }

  getDbFeeds(projectId: string): readonly DbFeedObservation[] {
    this.ensureLoaded();
    return this.dbFeeds.get(projectId) ?? [];
  }

  getDeployFeeds(projectId: string): readonly DeployFeedObservation[] {
    this.ensureLoaded();
    return this.deployFeeds.get(projectId) ?? [];
  }

  recordEvent(event: Record<string, unknown>): void {
    this.ensureLoaded();
    this.events.push(event);
    this.persist();
  }

  appendDomainEvent(event: DomainEvent): void {
    this.ensureLoaded();
    this.events.push(event);
    this.persist();
  }

  listDomainEvents(): DomainEvent[] {
    this.ensureLoaded();
    const out: DomainEvent[] = [];
    for (const raw of this.events) {
      if (
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as { id?: unknown }).id === "string" &&
        typeof (raw as { type?: unknown }).type === "string" &&
        typeof (raw as { occurredAt?: unknown }).occurredAt === "string" &&
        typeof (raw as { payload?: unknown }).payload === "object"
      ) {
        out.push(raw as DomainEvent);
      }
    }
    return out.reverse();
  }

  countEvidenceRecords(): number {
    this.ensureLoaded();
    let n = 0;
    for (const list of this.evidence.values()) n += list.length;
    return n;
  }

  countConnectedIntegrations(): number {
    this.ensureLoaded();
    let n = 0;
    if (this.githubConnection?.status === "CONNECTED") n += 1;
    if (this.localConnection?.status === "CONNECTED") n += 1;
    for (const binding of this.byoCloudBindings.values()) {
      if (binding.status === "connected") n += 1;
    }
    return n;
  }

  getByoCloudBinding(ownerId: string): StoredByoCloudBinding | null {
    this.ensureLoaded();
    return this.byoCloudBindings.get(ownerId) ?? null;
  }

  countConnectedByoCloudBindings(): number {
    this.ensureLoaded();
    let n = 0;
    for (const binding of this.byoCloudBindings.values()) {
      if (binding.status === "connected") n += 1;
    }
    return n;
  }

  setByoCloudBinding(ownerId: string, binding: StoredByoCloudBinding): void {
    this.ensureLoaded();
    this.byoCloudBindings.set(ownerId, binding);
    this.persist();
  }

  clearByoCloudBinding(ownerId: string): void {
    this.ensureLoaded();
    this.byoCloudBindings.delete(ownerId);
    this.persist();
  }

  incrementEvalRunMeter(dayKey: string): number {
    this.ensureLoaded();
    if (!this.usageMeters.evalRunsByDay) {
      this.usageMeters.evalRunsByDay = {};
    }
    const next = (this.usageMeters.evalRunsByDay[dayKey] ?? 0) + 1;
    this.usageMeters.evalRunsByDay[dayKey] = next;
    this.persist();
    return next;
  }

  getEvalRunsToday(dayKey: string): number {
    this.ensureLoaded();
    return this.usageMeters.evalRunsByDay[dayKey] ?? 0;
  }

  incrementProcessAuditMeter(dayKey: string): number {
    this.ensureLoaded();
    if (!this.usageMeters.processAuditsByDay) {
      this.usageMeters.processAuditsByDay = {};
    }
    const next = (this.usageMeters.processAuditsByDay[dayKey] ?? 0) + 1;
    this.usageMeters.processAuditsByDay[dayKey] = next;
    this.persist();
    return next;
  }

  getProcessAuditsToday(dayKey: string): number {
    this.ensureLoaded();
    return this.usageMeters.processAuditsByDay?.[dayKey] ?? 0;
  }

  incrementAgentMessageMeter(dayKey: string): number {
    this.ensureLoaded();
    if (!this.usageMeters.agentMessagesByDay) {
      this.usageMeters.agentMessagesByDay = {};
    }
    const next = (this.usageMeters.agentMessagesByDay[dayKey] ?? 0) + 1;
    this.usageMeters.agentMessagesByDay[dayKey] = next;
    this.persist();
    return next;
  }

  getAgentMessagesToday(dayKey: string): number {
    this.ensureLoaded();
    return this.usageMeters.agentMessagesByDay?.[dayKey] ?? 0;
  }

  upsertGateGraph(graph: QualityGateGraph): void {
    this.ensureLoaded();
    const idx = this.gateGraphs.findIndex(
      (g) =>
        g.id === graph.id ||
        (g.projectId === graph.projectId && g.name === graph.name),
    );
    if (idx >= 0) this.gateGraphs[idx] = graph;
    else this.gateGraphs.push(graph);
    this.persist();
  }

  getGateGraph(projectId: string | null): QualityGateGraph | undefined {
    this.ensureLoaded();
    return this.gateGraphs.find((g) => g.projectId === projectId);
  }

  getGateGraphById(id: string): QualityGateGraph | undefined {
    this.ensureLoaded();
    return this.gateGraphs.find((g) => g.id === id);
  }

  addEvalRun(run: EvalRun): void {
    this.ensureLoaded();
    this.evalRuns.unshift(run);
    this.persist();
  }

  listEvalRuns(): readonly EvalRun[] {
    this.ensureLoaded();
    return this.evalRuns;
  }

  upsertLoopRun(run: EngineeringLoopRun): void {
    this.ensureLoaded();
    const idx = this.loopRuns.findIndex((r) => r.id === run.id);
    if (idx >= 0) this.loopRuns[idx] = run;
    else this.loopRuns.unshift(run);
    this.persist();
  }

  getLoopRun(id: string): EngineeringLoopRun | undefined {
    this.ensureLoaded();
    return this.loopRuns.find((r) => r.id === id);
  }

  listLoopRuns(): readonly EngineeringLoopRun[] {
    this.ensureLoaded();
    return this.loopRuns;
  }

  addEvalSuite(suite: AtlasEvalSuiteRun): void {
    this.ensureLoaded();
    this.evalSuites.unshift(suite);
    this.persist();
  }

  getEvalSuite(id: string): AtlasEvalSuiteRun | undefined {
    this.ensureLoaded();
    return this.evalSuites.find((s) => s.id === id);
  }

  listEvalSuites(): readonly AtlasEvalSuiteRun[] {
    this.ensureLoaded();
    return this.evalSuites;
  }

  addRegressionReport(report: RegressionReport): void {
    this.ensureLoaded();
    this.regressionReports.unshift(report);
    this.persist();
  }

  addReadinessCertificate(cert: ProductionReadinessCertificate): void {
    this.ensureLoaded();
    this.readinessCertificates.unshift(cert);
    this.usageMeters.certificatesIssued =
      (this.usageMeters.certificatesIssued ?? 0) + 1;
    this.persist();
  }

  getReadinessCertificate(
    id: string,
  ): ProductionReadinessCertificate | undefined {
    this.ensureLoaded();
    return this.readinessCertificates.find((c) => c.id === id);
  }

  listReadinessCertificates(): readonly ProductionReadinessCertificate[] {
    this.ensureLoaded();
    return this.readinessCertificates;
  }

  incrementUsage(
    key:
      | "verdictsRequested"
      | "certificatesIssued"
      | "reportsGenerated"
      | "reposConnected"
      | "designPartnerSessions",
    by = 1,
  ): void {
    this.ensureLoaded();
    this.usageMeters[key] = (this.usageMeters[key] ?? 0) + by;
    this.persist();
  }

  getUsageSnapshot(): UsageMeters {
    this.ensureLoaded();
    return { ...this.usageMeters, evalRunsByDay: { ...this.usageMeters.evalRunsByDay } };
  }

  getCredits(): CreditsBalance | null {
    this.ensureLoaded();
    return this.credits;
  }

  setCredits(credits: CreditsBalance): void {
    this.ensureLoaded();
    this.credits = credits;
    this.persist();
  }

  upsertArtifact(artifact: Artifact): void {
    this.ensureLoaded();
    const idx = this.artifacts.findIndex((a) => a.id === artifact.id);
    if (idx >= 0) this.artifacts[idx] = artifact;
    else this.artifacts.push(artifact);
    this.persist();
  }

  getArtifact(id: string): Artifact | undefined {
    this.ensureLoaded();
    return this.artifacts.find((a) => a.id === id);
  }

  listArtifacts(): readonly Artifact[] {
    this.ensureLoaded();
    return this.artifacts;
  }

  addAssistRun(run: AssistRun): void {
    this.ensureLoaded();
    this.assistRuns.push(run);
    this.persist();
  }

  listAssistRuns(): readonly AssistRun[] {
    this.ensureLoaded();
    return this.assistRuns;
  }

  upsertPatch(patch: PatchArtifact): void {
    this.ensureLoaded();
    const idx = this.patches.findIndex((p) => p.id === patch.id);
    if (idx >= 0) this.patches[idx] = patch;
    else this.patches.push(patch);
    this.persist();
  }

  getPatch(id: string): PatchArtifact | undefined {
    this.ensureLoaded();
    return this.patches.find((p) => p.id === id);
  }

  listPatches(projectId?: string | null): readonly PatchArtifact[] {
    this.ensureLoaded();
    if (projectId === undefined) return this.patches;
    if (projectId === null) {
      return this.patches.filter((p) => p.projectId === null);
    }
    return this.patches.filter((p) => p.projectId === projectId);
  }

  /**
   * Append-only audit: durable NDJSON under `.atlas/audit/audit.ndjson`
   * (hash-chained) plus an in-memory / store.json ring for API reads.
   * The file log is never truncated.
   */
  appendAudit(entry: Record<string, unknown>): void {
    this.ensureLoaded();
    const record = appendAuditLogLine(entry);
    this.audit.push({
      id: record.id,
      at: record.at,
      type: record.type,
      prevHash: record.prevHash,
      hash: record.hash,
      ...record.payload,
    });
    if (this.audit.length > AUDIT_MEMORY_RING) {
      this.audit = this.audit.slice(-AUDIT_MEMORY_RING);
    }
    this.persist();
  }

  listAudit(): readonly Record<string, unknown>[] {
    this.ensureLoaded();
    return this.audit;
  }

  /** Path of the durable append-only audit file (may not exist yet). */
  getAuditLogPath(): string {
    return resolveAuditLogPath();
  }

  addAgentRun(run: AgentRun): void {
    this.ensureLoaded();
    this.agentRuns.push(run);
    if (this.agentRuns.length > 200) {
      this.agentRuns = this.agentRuns.slice(-200);
    }
    this.persist();
  }

  listAgentRuns(): readonly AgentRun[] {
    this.ensureLoaded();
    return this.agentRuns;
  }

  getConflictResolution(id: string): string | undefined {
    this.ensureLoaded();
    return this.conflictResolutions.get(id);
  }

  setConflictResolution(id: string, resolution: string): void {
    this.ensureLoaded();
    this.conflictResolutions.set(id, resolution);
    this.persist();
  }

  addContactLead(lead: ContactLead): void {
    this.ensureLoaded();
    this.contactLeads.push(lead);
    this.persist();
  }

  listContactLeads(): readonly ContactLead[] {
    this.ensureLoaded();
    return this.contactLeads;
  }

  getMeta(key: string): string | undefined {
    this.ensureLoaded();
    return this.meta[key];
  }

  setMeta(key: string, value: string): void {
    this.ensureLoaded();
    this.meta[key] = value;
    this.persist();
  }

  getConversationThread(threadId: string): readonly ConversationThreadTurn[] {
    this.ensureLoaded();
    return this.conversationThreads.get(threadId) ?? [];
  }

  setConversationThread(
    threadId: string,
    turns: readonly ConversationThreadTurn[],
  ): void {
    this.ensureLoaded();
    this.conversationThreads.set(threadId, [...turns].slice(-40));
    this.persist();
  }

  getWorkspaceRoot(projectId: string): string | undefined {
    this.ensureLoaded();
    return this.workspaceRoots[projectId];
  }

  setWorkspaceRoot(projectId: string, workspaceRoot: string | null): void {
    this.ensureLoaded();
    if (!workspaceRoot) {
      delete this.workspaceRoots[projectId];
    } else {
      this.workspaceRoots[projectId] = workspaceRoot;
    }
    this.persist();
  }

  listWorkspaceRoots(): Readonly<Record<string, string>> {
    this.ensureLoaded();
    return { ...this.workspaceRoots };
  }

  /**
   * Startup recovery: merge cloud rows into an empty (or sparse) local store
   * and flush once. Idempotent for ids already present.
   */
  applyCloudHydration(input: {
    readonly projects?: readonly Project[];
    readonly memories?: readonly Memory[];
    readonly decisions?: readonly Decision[];
    readonly tenantSubscriptions?: readonly StoredTenantSubscription[];
    readonly meta?: Readonly<Record<string, string>>;
  }): { projects: number; memories: number; decisions: number; plans: number } {
    this.ensureLoaded();
    let projects = 0;
    let memories = 0;
    let decisions = 0;
    let plans = 0;
    const now = new Date().toISOString();

    for (const project of input.projects ?? []) {
      if (!this.projects.some((p) => p.id === project.id || p.slug === project.slug)) {
        this.projects.push(project);
        projects += 1;
      }
      if (!this.cloudLinks.has(project.id)) {
        this.cloudLinks.set(project.id, { cloudProjectId: project.id, syncedAt: now });
      }
    }

    for (const memory of input.memories ?? []) {
      const key = memory.projectId ?? "global";
      const list = this.memories.get(key) ?? [];
      if (list.some((m) => m.id === memory.id)) continue;
      this.memories.set(key, [...list, memory]);
      memories += 1;
    }

    for (const decision of input.decisions ?? []) {
      const key = decision.projectId ?? "global";
      const list = this.decisions.get(key) ?? [];
      if (list.some((d) => d.id === decision.id)) continue;
      this.decisions.set(key, [...list, decision]);
      decisions += 1;
    }

    for (const sub of input.tenantSubscriptions ?? []) {
      if (this.tenantSubscriptions.has(sub.ownerId)) continue;
      this.tenantSubscriptions.set(sub.ownerId, sub);
      plans += 1;
    }

    if (input.meta) {
      for (const [k, v] of Object.entries(input.meta)) {
        if (this.meta[k] === undefined) this.meta[k] = v;
      }
    }

    if (projects + memories + decisions + plans > 0 || input.meta) {
      this.persist();
    }
    return { projects, memories, decisions, plans };
  }
}

void emptyShape;

export const osStore = new OsStore();
