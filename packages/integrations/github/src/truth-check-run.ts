/**
 * Post Atlas Truth observe results as a GitHub Check Run (TRUTH-10 · 1.6).
 * Requires GitHub App permission: checks:write
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "ArletOS-Atlas";
const API_VERSION = "2022-11-28";

export type TruthCheckConclusion =
  | "success"
  | "neutral"
  | "action_required"
  | "failure";

export function conclusionForRiskBand(band: string): TruthCheckConclusion {
  const upper = band.toUpperCase();
  if (upper === "CRITICAL") return "failure";
  if (upper === "HIGH") return "action_required";
  if (upper === "MEDIUM") return "neutral";
  return "success";
}

export function splitRepoFullName(
  fullName: string,
): { owner: string; repo: string } | null {
  const parts = fullName.trim().split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function buildTruthCheckRunBody(input: {
  headSha: string;
  riskBand: string;
  riskScore: number;
  topFindingTitle: string | null;
  observeCycleId: string;
  detailsUrl?: string | null;
  startedAt?: string;
  completedAt?: string;
}): Record<string, unknown> {
  const conclusion = conclusionForRiskBand(input.riskBand);
  const title = `Atlas Truth · ${input.riskBand}`;
  const summaryParts = [
    `Risk **${input.riskBand}** (score ${input.riskScore}).`,
    input.topFindingTitle
      ? `Top finding: ${input.topFindingTitle}`
      : "No high-priority finding on this cycle.",
    `Observe cycle: \`${input.observeCycleId}\``,
    "",
    "_No evidence = no strong claim. Atlas does not auto-merge or rewrite your PR._",
  ];

  const body: Record<string, unknown> = {
    name: "Atlas Truth",
    head_sha: input.headSha,
    status: "completed",
    conclusion,
    started_at: input.startedAt ?? new Date().toISOString(),
    completed_at: input.completedAt ?? new Date().toISOString(),
    output: {
      title,
      summary: summaryParts.join("\n"),
      text: summaryParts.join("\n"),
    },
  };
  if (input.detailsUrl) {
    body.details_url = input.detailsUrl;
  }
  return body;
}

export async function postAtlasTruthCheckRun(input: {
  token: string;
  fullName: string;
  headSha: string;
  riskBand: string;
  riskScore: number;
  topFindingTitle: string | null;
  observeCycleId: string;
  detailsUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; id: number; htmlUrl: string | null } | { ok: false; reason: string }> {
  const split = splitRepoFullName(input.fullName);
  if (!split) return { ok: false, reason: "invalid_full_name" };
  if (!input.headSha || /^0+$/.test(input.headSha)) {
    return { ok: false, reason: "missing_head_sha" };
  }

  const doFetch = input.fetchImpl ?? fetch;
  const body = buildTruthCheckRunBody({
    headSha: input.headSha,
    riskBand: input.riskBand,
    riskScore: input.riskScore,
    topFindingTitle: input.topFindingTitle,
    observeCycleId: input.observeCycleId,
    ...(input.detailsUrl !== undefined ? { detailsUrl: input.detailsUrl } : {}),
  });

  const res = await doFetch(
    `${GITHUB_API_BASE}/repos/${split.owner}/${split.repo}/check-runs`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      reason: `github_${res.status}:${text.slice(0, 200)}`,
    };
  }

  const json = (await res.json()) as { id?: number; html_url?: string | null };
  return {
    ok: true,
    id: typeof json.id === "number" ? json.id : 0,
    htmlUrl: typeof json.html_url === "string" ? json.html_url : null,
  };
}

/** Prefer webhook installation.id, then stored project installation. */
export function resolveInstallationIdForCheck(input: {
  webhookInstallationId?: string | number | null;
  projectInstallationId?: string | null;
}): string | null {
  if (
    input.webhookInstallationId !== undefined &&
    input.webhookInstallationId !== null &&
    String(input.webhookInstallationId).length > 0
  ) {
    return String(input.webhookInstallationId);
  }
  if (input.projectInstallationId) return input.projectInstallationId;
  return null;
}
