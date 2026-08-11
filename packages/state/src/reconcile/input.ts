import type {
  Claim,
  Decision,
  EpistemicState,
  EvidenceRecord,
  Memory,
  ProjectStateSliceKey,
} from "@atlas/shared";

/** Connector-agnostic observation fed into reconciliation. */
export interface ConnectorObservation {
  readonly connector: "github" | "supabase" | "mongodb";
  readonly projectId: string;
  readonly observedAt: string;
  readonly repository?: {
    readonly fullName: string;
    readonly defaultBranch: string | null;
    readonly private: boolean;
    readonly htmlUrl: string | null;
    readonly lastSyncedAt: string | null;
  };
  readonly headSha?: string | null;
  readonly openPrCount?: number;
  readonly openIssueCount?: number;
  readonly dependencyManifests?: readonly string[];
  readonly hasCiConfig?: boolean;
  readonly architectureDocPaths?: readonly string[];
  readonly testSignals?: {
    readonly hasTestDirectory: boolean;
    readonly recentCiStatus: "success" | "failure" | "unknown" | null;
  };
  readonly securitySignals?: {
    readonly hasDependabot: boolean;
    readonly hasCodeowners: boolean;
  };
  readonly database?: {
    readonly provider: "supabase" | "mongodb";
    readonly summary: string;
    readonly objectCount: number;
    readonly objectNames: readonly string[];
    readonly rlsEnabled: boolean | null;
    readonly host: string | null;
  };
}

export interface ReconciliationInput {
  readonly projectId: string;
  readonly asOf?: string;
  readonly observations: readonly ConnectorObservation[];
  readonly evidence: readonly EvidenceRecord[];
  readonly claims: readonly Claim[];
  readonly memories: readonly Memory[];
  readonly decisions: readonly Decision[];
  readonly openTasks?: readonly string[];
  readonly knownRisks?: readonly string[];
}

export interface SliceDraft {
  readonly key: ProjectStateSliceKey;
  readonly summary: string;
  readonly epistemicState: EpistemicState;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly asOf: string;
  readonly validUntil: string | null;
  readonly stale: boolean;
  readonly conflictingClaimIds?: readonly [string, string];
}
