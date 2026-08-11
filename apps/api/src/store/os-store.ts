import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Claim,
  Decision,
  EvidenceRecord,
  Memory,
  Project,
  ProjectStateSnapshot,
  Artifact,
  AssistRun,
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
import type { ConnectorObservation } from "@atlas/state";
import type { GitHubRepoObservation } from "@atlas/integrations-github";

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
  openTasks: Record<string, string[]>;
  events: Array<Record<string, unknown>>;
  githubConnection?: StoredGithubConnection | null;
  localConnection?: StoredLocalConnection | null;
  /** Local project id → cloud row id (ADR-011) */
  cloudLinks?: Record<string, CloudProjectLink>;
  plan?: StoredPlan | null;
  artifacts?: Artifact[];
  assistRuns?: AssistRun[];
  credits?: CreditsBalance | null;
  conflictResolutions?: Record<string, string>;
  audit?: Array<Record<string, unknown>>;
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
}

export interface CloudProjectLink {
  cloudProjectId: string;
  syncedAt: string;
}

export interface StoredPlan {
  tier: "free" | "pro";
  updatedAt: string;
}

export interface UsageMeters {
  evalRunsByDay: Record<string, number>;
  verdictsRequested?: number;
  certificatesIssued?: number;
  reportsGenerated?: number;
  reposConnected?: number;
  designPartnerSessions?: number;
}


function storePath(): string {
  const fromEnv = process.env.ATLAS_STORE_PATH;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, ".atlas", "store.json");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(process.cwd(), ".atlas", "store.json");
    }
    dir = parent;
  }
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
    openTasks: {},
    events: [],
    githubConnection: null,
    localConnection: null,
    cloudLinks: {},
    plan: null,
    artifacts: [],
    assistRuns: [],
    credits: null,
    conflictResolutions: {},
    audit: [],
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
  readonly snapshots = new Map<string, ProjectStateSnapshot>();
  readonly openTasks = new Map<string, string[]>();
  events: Array<Record<string, unknown>> = [];
  private githubConnection: StoredGithubConnection | null = null;
  private localConnection: StoredLocalConnection | null = null;
  private cloudLinks = new Map<string, CloudProjectLink>();
  private plan: StoredPlan | null = null;
  private artifacts: Artifact[] = [];
  private assistRuns: AssistRun[] = [];
  private credits: CreditsBalance | null = null;
  private conflictResolutions = new Map<string, string>();
  private audit: Array<Record<string, unknown>> = [];
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
  private loaded = false;

  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const path = storePath();
    if (!existsSync(path)) {
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as PersistedShape;
      this.projects = raw.projects ?? [];
      for (const [k, v] of Object.entries(raw.evidence ?? {})) {
        this.evidence.set(k, v);
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
        this.rebuildGithubObservation(k, v);
      }
      for (const [k, v] of Object.entries(raw.dbFeeds ?? {})) {
        this.dbFeeds.set(k, v);
        this.rebuildDbObservations(k, v);
      }
      for (const [k, v] of Object.entries(raw.openTasks ?? {})) {
        this.openTasks.set(k, v);
      }
      this.events = raw.events ?? [];
      this.githubConnection = raw.githubConnection ?? null;
      this.localConnection = raw.localConnection ?? null;
      this.cloudLinks = new Map(Object.entries(raw.cloudLinks ?? {}));
      this.plan = raw.plan ?? null;
      this.artifacts = raw.artifacts ?? [];
      this.assistRuns = raw.assistRuns ?? [];
      this.credits = raw.credits ?? null;
      this.conflictResolutions = new Map(
        Object.entries(raw.conflictResolutions ?? {}),
      );
      this.audit = raw.audit ?? [];
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
    } catch {
      // corrupt store — start fresh
    }
  }

  persist(): void {
    this.ensureLoaded();
    const path = storePath();
    mkdirSync(dirname(path), { recursive: true });
    const shape: PersistedShape = {
      projects: this.projects,
      evidence: Object.fromEntries(this.evidence),
      claims: Object.fromEntries(this.claims),
      memories: Object.fromEntries(this.memories),
      decisions: Object.fromEntries(this.decisions),
      snapshots: Object.fromEntries(this.snapshots),
      github: Object.fromEntries(this.github),
      dbFeeds: Object.fromEntries(this.dbFeeds),
      openTasks: Object.fromEntries(this.openTasks),
      events: this.events.slice(-500),
      githubConnection: this.githubConnection,
      localConnection: this.localConnection,
      cloudLinks: Object.fromEntries(this.cloudLinks),
      plan: this.plan,
      artifacts: this.artifacts,
      assistRuns: this.assistRuns.slice(-200),
      credits: this.credits,
      conflictResolutions: Object.fromEntries(this.conflictResolutions),
      audit: this.audit.slice(-1000),
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
    };
    writeFileSync(path, JSON.stringify(shape, null, 2), "utf8");
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
    return this.evidence.get(projectId) ?? [];
  }

  addEvidence(projectId: string, records: readonly EvidenceRecord[]): void {
    this.ensureLoaded();
    const existing = this.getEvidence(projectId);
    this.evidence.set(projectId, [...existing, ...records]);
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

  addDecision(decision: Decision): void {
    this.ensureLoaded();
    const projectId = decision.projectId ?? "global";
    const existing = this.decisions.get(projectId) ?? [];
    this.decisions.set(projectId, [...existing, decision]);
    this.persist();
  }

  setGitHubObservation(
    projectId: string,
    observation: GitHubRepoObservation,
  ): void {
    this.ensureLoaded();
    this.github.set(projectId, observation);
    this.rebuildGithubObservation(projectId, observation);
    this.persist();
  }

  setDbFeed(projectId: string, feed: DbFeedObservation): void {
    this.ensureLoaded();
    const existing = (this.dbFeeds.get(projectId) ?? []).filter(
      (item) => item.provider !== feed.provider,
    );
    const next = [...existing, feed];
    this.dbFeeds.set(projectId, next);
    this.rebuildDbObservations(projectId, next);
    this.persist();
  }

  private rebuildGithubObservation(
    projectId: string,
    observation: GitHubRepoObservation,
  ): void {
    const connectorObs: ConnectorObservation = {
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
    };
    const others = (this.observations.get(projectId) ?? []).filter(
      (item) => item.connector !== "github",
    );
    this.observations.set(projectId, [...others, connectorObs]);
  }

  private rebuildDbObservations(
    projectId: string,
    feeds: readonly DbFeedObservation[],
  ): void {
    const nonDb = (this.observations.get(projectId) ?? []).filter(
      (item) => item.connector === "github",
    );
    const dbObs: ConnectorObservation[] = feeds.map((feed) => ({
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
    }));
    this.observations.set(projectId, [...nonDb, ...dbObs]);
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
    return n;
  }

  incrementEvalRunMeter(dayKey: string): number {
    this.ensureLoaded();
    const next = (this.usageMeters.evalRunsByDay[dayKey] ?? 0) + 1;
    this.usageMeters.evalRunsByDay[dayKey] = next;
    this.persist();
    return next;
  }

  getEvalRunsToday(dayKey: string): number {
    this.ensureLoaded();
    return this.usageMeters.evalRunsByDay[dayKey] ?? 0;
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

  appendAudit(entry: Record<string, unknown>): void {
    this.ensureLoaded();
    this.audit.push(entry);
    this.persist();
  }

  listAudit(): readonly Record<string, unknown>[] {
    this.ensureLoaded();
    return this.audit;
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
}

void emptyShape;

export const osStore = new OsStore();
