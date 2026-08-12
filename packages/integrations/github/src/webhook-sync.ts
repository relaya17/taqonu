import { slugFromFullName } from "./discover.js";

export type CiStatus = "success" | "failure" | "unknown";

export interface ProjectMatchCandidate {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Prior GitHub observation fullName when known. */
  readonly githubFullName?: string | null;
}

export interface WebhookRepoFields {
  readonly fullName: string;
  readonly defaultBranch: string | null;
  readonly private: boolean | undefined;
  readonly htmlUrl: string | null;
}

export interface IncrementalWebhookSync {
  readonly shouldSync: boolean;
  readonly event: string;
  readonly repo: WebhookRepoFields | null;
  readonly headSha: string | null;
  readonly recentCiStatus: CiStatus | null;
  readonly reason?: string;
}

const SYNC_EVENTS = new Set(["push", "pull_request"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function mapConclusionToCi(raw: string | null | undefined): CiStatus | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower === "success" ||
    lower === "neutral" ||
    lower === "skipped" ||
    lower === "completed"
  ) {
    return "success";
  }
  if (
    lower === "failure" ||
    lower === "timed_out" ||
    lower === "cancelled" ||
    lower === "canceled" ||
    lower === "error" ||
    lower === "action_required" ||
    lower === "startup_failure"
  ) {
    return "failure";
  }
  if (
    lower === "pending" ||
    lower === "queued" ||
    lower === "in_progress" ||
    lower === "waiting" ||
    lower === "requested" ||
    lower === "stale"
  ) {
    return "unknown";
  }
  return "unknown";
}

/** Prefer exact observation fullName, then slug heuristics, then name. */
export function matchProjectByRepoFullName(
  fullName: string,
  projects: readonly ProjectMatchCandidate[],
): ProjectMatchCandidate | undefined {
  const normalized = fullName.trim().toLowerCase();
  if (!normalized) return undefined;

  const byObservation = projects.find(
    (p) => p.githubFullName?.trim().toLowerCase() === normalized,
  );
  if (byObservation) return byObservation;

  const derivedSlug = slugFromFullName(fullName);
  const byDerivedSlug = projects.find((p) => p.slug === derivedSlug);
  if (byDerivedSlug) return byDerivedSlug;

  const repoName = fullName.split("/")[1]?.toLowerCase();
  if (repoName) {
    const byRepoSlug = projects.find((p) => p.slug === repoName);
    if (byRepoSlug) return byRepoSlug;
  }

  return projects.find((p) => {
    const name = p.name.toLowerCase();
    return name === normalized || (repoName !== undefined && name === repoName);
  });
}

export function extractRecentCiStatus(
  body: Record<string, unknown>,
): CiStatus | null {
  const checkSuite = asRecord(body.check_suite);
  const checkRun = asRecord(body.check_run);
  const workflowRun = asRecord(body.workflow_run);
  const status = asRecord(body.status);

  const candidates: Array<string | null | undefined> = [
    typeof checkSuite?.conclusion === "string" ? checkSuite.conclusion : null,
    typeof checkRun?.conclusion === "string" ? checkRun.conclusion : null,
    typeof workflowRun?.conclusion === "string" ? workflowRun.conclusion : null,
    typeof status?.state === "string" ? status.state : null,
  ];

  for (const candidate of candidates) {
    const mapped = mapConclusionToCi(candidate);
    if (mapped) return mapped;
  }
  return null;
}

export function extractHeadSha(
  event: string,
  body: Record<string, unknown>,
): string | null {
  if (event === "push" && typeof body.after === "string" && body.after.length > 0) {
    // GitHub uses all-zero after for branch deletes
    if (/^0+$/.test(body.after)) return null;
    return body.after;
  }

  const pullRequest = asRecord(body.pull_request);
  const head = asRecord(pullRequest?.head);
  if (typeof head?.sha === "string" && head.sha.length > 0) {
    return head.sha;
  }

  if (typeof body.after === "string" && body.after.length > 0 && !/^0+$/.test(body.after)) {
    return body.after;
  }

  return null;
}

export function parseWebhookRepo(
  body: Record<string, unknown>,
): WebhookRepoFields | null {
  const repo = asRecord(body.repository);
  if (!repo) return null;

  const fullNameRaw = repo["full_name"];
  const fullName = typeof fullNameRaw === "string" ? fullNameRaw.trim() : "";
  if (!fullName) return null;

  const defaultBranchRaw = repo["default_branch"];
  const privateRaw = repo["private"];
  const htmlUrlRaw = repo["html_url"];

  return {
    fullName,
    defaultBranch:
      typeof defaultBranchRaw === "string" ? defaultBranchRaw : null,
    private: typeof privateRaw === "boolean" ? privateRaw : undefined,
    htmlUrl: typeof htmlUrlRaw === "string" ? htmlUrlRaw : null,
  };
}

/**
 * Incremental sync fields for push / pull_request webhooks.
 * Other events are accepted but do not drive sync in this MVP+.
 */
export function extractIncrementalWebhookSync(input: {
  event: string;
  body: Record<string, unknown>;
}): IncrementalWebhookSync {
  const event = input.event;
  if (!SYNC_EVENTS.has(event)) {
    return {
      shouldSync: false,
      event,
      repo: null,
      headSha: null,
      recentCiStatus: null,
      reason: "event_not_incremental",
    };
  }

  const repo = parseWebhookRepo(input.body);
  if (!repo) {
    return {
      shouldSync: false,
      event,
      repo: null,
      headSha: null,
      recentCiStatus: null,
      reason: "missing_repository",
    };
  }

  return {
    shouldSync: true,
    event,
    repo,
    headSha: extractHeadSha(event, input.body),
    recentCiStatus: extractRecentCiStatus(input.body),
  };
}

/**
 * Build the GitHub App install/setup URL.
 * When `state` is provided (a signed token from install-state.ts) it is
 * appended as a query param, which GitHub echoes back unmodified on the
 * installation callback so we can verify + route the request.
 */
export function buildGitHubAppSetupUrl(slug: string, state?: string): string {
  const cleaned = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = `https://github.com/apps/${cleaned}/installations/new`;
  return state ? `${base}?state=${encodeURIComponent(state)}` : base;
}

export function resolveGitHubAppSlug(env: {
  GITHUB_APP_SLUG?: string | undefined;
  GITHUB_APP_NAME?: string | undefined;
}): string | null {
  if (env.GITHUB_APP_SLUG?.trim()) {
    return env.GITHUB_APP_SLUG.trim().toLowerCase();
  }
  if (env.GITHUB_APP_NAME?.trim()) {
    return env.GITHUB_APP_NAME
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  return null;
}

export const GITHUB_INSTALLATION_STATES = {
  not_configured:
    "Missing App credentials (GITHUB_APP_ID / GITHUB_PRIVATE_KEY / webhook secret).",
  configured:
    "App ID + private key set; webhook secret not yet configured.",
  webhook_ready:
    "App credentials + webhook secret set; waiting for first signed webhook.",
  active: "Webhook received at least once; incremental sync path is live.",
} as const;
