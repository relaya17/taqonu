"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { OnboardingPath } from "@/components/onboarding/OnboardingPath";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { Link } from "@/i18n/routing";
import type { EpistemicState } from "@atlas/shared";

interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  techStack: string[];
  status: string;
  cloudSynced?: boolean;
  cloudProjectId?: string | null;
  cloudSyncedAt?: string | null;
  workspaceRoot?: string | null;
}

interface PortfolioOverview {
  projectCount: number;
  epistemicState: "INFERRED" | "UNKNOWN";
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    stateEpistemic: string | null;
    lastReconciledAt: string | null;
  }>;
}

interface AccountPlan {
  remainingCloudSlots: number;
  cloudConfigured: boolean;
  tier: string;
}

interface PortfolioHealthItem {
  projectId: string;
  slug: string;
  name: string;
  workspaceRoot: string | null;
  overallScore: number | null;
  criticalIssues: number;
  highRisk?: number;
  constitutionScore: number | null;
  architectureDriftScore?: number | null;
  dimensions?: Array<{ key: string; score: number }>;
  blockers?: Array<{ title: string; severity: string; category?: string }>;
  driftCount?: number;
  verdictHint?: string;
  epistemicState: string;
  notes: string;
}

interface PortfolioHealth {
  projectCount: number;
  audited: number;
  skipped: number;
  averageScore: number | null;
  criticalTotal: number;
  aggregate: {
    averageScore: number | null;
    worstOfScore: number | null;
    criticalTotal: number;
    highTotal: number;
    constitutionWorst: number | null;
    constitutionAverage: number | null;
    openBlockers: number;
    worstDimensions: Array<{
      key: string;
      worstScore: number;
      averageScore: number;
      projectId: string;
      projectName: string;
    }>;
    sharedPatterns: Array<{
      key: string;
      title: string;
      category?: string;
      severity: string;
      projectCount: number;
      occurrenceCount: number;
    }>;
    portfolioVerdict: string;
  };
  items: PortfolioHealthItem[];
  epistemicState: string;
  asOf: string;
  note: string;
  persisted?: boolean;
}

interface PortfolioDiscoveryStatus {
  sources: {
    local: {
      connected: boolean;
      reposRoot: string | null;
      lastScanAt: string | null;
      lastScanRepoCount: number | null;
    };
    githubToken: { connected: boolean; login: string | null };
    githubApp: {
      configured: boolean;
      installationCount: number;
      installationIds: string[];
    };
  };
  summary: {
    projectCount: number;
    linkedCount: number;
    unlinkedCount: number;
    missingOnDiskCount: number;
    localCandidateCount: number;
    unregisteredLocalCount: number;
  };
  unlinkedProjects: Array<{
    projectId: string;
    slug: string;
    name: string;
    githubFullName: string | null;
    workspaceRoot: string | null;
    linkStatus: "LINKED" | "UNLINKED" | "MISSING_ON_DISK";
    notes?: string;
  }>;
  localCandidates: Array<{
    folderName: string;
    absolutePath: string;
    fullName: string | null;
    matchedProjectId: string | null;
    matchedSlug: string | null;
    alreadyLinked: boolean;
    registered: boolean;
  }>;
  pathHints: string[];
  note: string;
}

interface PortfolioDiscoveryRefreshResult {
  local: {
    scanned: number;
    created: number;
    updated: number;
    linked: number;
  } | null;
  githubToken: {
    imported: number;
    created: number;
    updated: number;
  } | null;
  githubApp: {
    installations: number;
    imported: number;
    created: number;
    updated: number;
    errors: string[];
  } | null;
  status: PortfolioDiscoveryStatus;
}

function verdictColor(
  verdict: string | undefined,
): "default" | "success" | "warning" | "error" {
  if (verdict === "READY") return "success";
  if (verdict === "CONDITIONAL") return "warning";
  if (verdict === "BLOCKED") return "error";
  return "default";
}

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const queryClient = useQueryClient();
  const [repoList, setRepoList] = useState(
    "owner/brokeros\nowner/hotelos\nowner/caseflow\nowner/lexstudy\nowner/vantera\nowner/dudu",
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rootDrafts, setRootDrafts] = useState<Record<string, string>>({});

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const portfolioQuery = useQuery({
    queryKey: ["portfolio-overview"],
    queryFn: () => apiGet<PortfolioOverview>("/api/v1/portfolio/overview"),
  });

  const planQuery = useQuery({
    queryKey: ["billing-plan"],
    queryFn: () => apiGet<AccountPlan>("/api/v1/billing/plan"),
  });

  const healthQuery = useQuery({
    queryKey: ["portfolio-health"],
    queryFn: () => apiGet<PortfolioHealth>("/api/v1/portfolio/health"),
  });

  const discoveryQuery = useQuery({
    queryKey: ["portfolio-discovery"],
    queryFn: () =>
      apiGet<PortfolioDiscoveryStatus>("/api/v1/portfolio/discovery"),
  });

  const discover = useMutation({
    mutationFn: async () => {
      const repositories = repoList
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((fullName) => ({ fullName }));
      return apiPost<{ created: number; updated: number; projects: Project[] }>(
        "/api/v1/github/discover",
        { repositories, reconcile: true },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
  });

  const refreshDiscovery = useMutation({
    mutationFn: () =>
      apiPost<PortfolioDiscoveryRefreshResult>(
        "/api/v1/portfolio/discovery/refresh",
        { reconcile: true, linkLocalRoots: true },
      ),
    onSuccess: async (data) => {
      queryClient.setQueryData(["portfolio-discovery"], data.status);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
    },
  });

  // One-shot auto-link when local discovery shows unlinked projects.
  useEffect(() => {
    if (!discoveryQuery.isSuccess || refreshDiscovery.isPending) return;
    const status = discoveryQuery.data;
    if (!status?.sources.local.connected) return;
    if ((status.summary.unlinkedCount ?? 0) <= 0) return;
    const key = "atlas.autoDiscoveryRefresh";
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch {
      // continue once even if storage blocked
    }
    refreshDiscovery.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on first discovery load
  }, [discoveryQuery.isSuccess, discoveryQuery.data?.summary.unlinkedCount]);

  const linkDiscovery = useMutation({
    mutationFn: (input: { projectId: string; workspaceRoot: string }) =>
      apiPost("/api/v1/portfolio/discovery/link", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
  });

  const importAndLink = useMutation({
    mutationFn: (candidate: {
      folderName: string;
      absolutePath: string;
    }) => {
      const base = candidate.folderName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 56);
      const slug = `${base || "local-project"}-${Date.now().toString(36).slice(-4)}`;
      return apiPost("/api/v1/onboarding/import", {
        source: "local",
        name: candidate.folderName,
        slug,
        workspaceRoot: candidate.absolutePath,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
  });

  const uploadCloud = useMutation({
    mutationFn: (projectId: string) =>
      apiPost(`/api/v1/projects/${projectId}/cloud`, {}),
    onSuccess: async () => {
      setUploadError(null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
    },
    onError: (error: Error) => {
      setUploadError(error.message || t("quotaBlocked"));
    },
  });

  const saveRoot = useMutation({
    mutationFn: ({
      projectId,
      workspaceRoot,
    }: {
      projectId: string;
      workspaceRoot: string | null;
    }) =>
      apiPut(`/api/v1/projects/${projectId}/workspace-root`, {
        workspaceRoot,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
  });

  const portfolioHealth = useMutation({
    mutationFn: () => apiPost<PortfolioHealth>("/api/v1/portfolio/health", {}),
    onSuccess: (data) => {
      queryClient.setQueryData(["portfolio-health"], data);
    },
  });

  const items = projectsQuery.data?.items ?? [];
  const projectsLoading = projectsQuery.isLoading || portfolioQuery.isLoading;
  const plan = planQuery.data;
  const canUpload =
    Boolean(plan?.cloudConfigured) && (plan?.remainingCloudSlots ?? 0) > 0;
  const health = portfolioHealth.data ?? healthQuery.data;
  const aggregate = health?.aggregate;
  const healthByProject = new Map(
    (health?.items ?? []).map((item) => [item.projectId, item]),
  );
  const discovery = discoveryQuery.data;
  const unlinked = discovery?.unlinkedProjects ?? [];
  const candidates = discovery?.localCandidates ?? [];
  const missingRootCount = items.filter((p) => !p.workspaceRoot).length;

  return (
    <Stack spacing={3} sx={{ maxWidth: 900, width: "100%", minWidth: 0 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.4rem" }, wordBreak: "break-word" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}{" "}
          <Link href="/integrations">{t("openIntegrations")}</Link>
          {" · "}
          <Link href="/plan">{t("viewPlan")}</Link>
        </Typography>
        <Box sx={{ mt: 2 }}>
          <OnboardingPath missingRootCount={missingRootCount} />
        </Box>
        {plan?.tier === "free" ? (
          <Alert
            severity="warning"
            sx={{ mt: 2 }}
            action={
              <Button component={Link} href="/plan" color="inherit" size="small">
                {t("viewPlan")}
              </Button>
            }
          >
            {t("quotaSell")}
          </Alert>
        ) : null}
        {!canUpload ? (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {t("uploadCloudDisabledHint")}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
          <EpistemicChip
            state={portfolioQuery.data?.epistemicState ?? "UNKNOWN"}
          />
          {projectsLoading ? (
            <Skeleton width={140} height={22} />
          ) : (
            <Typography variant="body2">
              {t("registered", {
                count: portfolioQuery.data?.projectCount ?? items.length,
              })}
            </Typography>
          )}
        </Stack>
      </Box>

      <Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography fontWeight={650}>{t("discoveryTitle")}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t("discoverySubtitle")}
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={() => refreshDiscovery.mutate()}
            disabled={refreshDiscovery.isPending}
          >
            {t("refreshDiscovery")}
          </Button>
        </Stack>
        {discovery ? (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <Typography variant="body2">
              {t("discoverySummary", {
                linked: discovery.summary.linkedCount,
                unlinked: discovery.summary.unlinkedCount,
                missing: discovery.summary.missingOnDiskCount,
                unregistered: discovery.summary.unregisteredLocalCount,
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {discovery.note}
              {discovery.pathHints.length > 0
                ? ` · ${discovery.pathHints.join(" · ")}`
                : ` · ${t("openIntegrationsHint")}`}
            </Typography>
            {refreshDiscovery.isSuccess ? (
              <Typography variant="body2">
                {t("discoveryRefreshResult", {
                  localScanned: refreshDiscovery.data.local?.scanned ?? 0,
                  localLinked: refreshDiscovery.data.local?.linked ?? 0,
                  ghImported: refreshDiscovery.data.githubToken?.imported ?? 0,
                  appImported: refreshDiscovery.data.githubApp?.imported ?? 0,
                })}
              </Typography>
            ) : null}
            {refreshDiscovery.isError ? (
              <Typography variant="body2" color="error">
                {(refreshDiscovery.error as Error).message}
              </Typography>
            ) : null}

            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t("unlinkedTitle")}
              </Typography>
              {unlinked.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t("unlinkedEmpty")}
                </Typography>
              ) : (
                <Stack spacing={0.75}>
                  {unlinked.map((item) => {
                    const hint = candidates.find(
                      (c) =>
                        c.matchedProjectId === item.projectId ||
                        (item.githubFullName &&
                          c.fullName?.toLowerCase() ===
                            item.githubFullName.toLowerCase()) ||
                        c.folderName.toLowerCase() === item.slug,
                    );
                    return (
                      <Box
                        key={item.projectId}
                        sx={{
                          py: 1,
                          borderBottom: "1px solid rgba(20,32,34,0.08)",
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 1,
                          alignItems: "center",
                        }}
                      >
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {item.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.slug}
                            {item.githubFullName
                              ? ` · ${item.githubFullName}`
                              : ""}
                            {item.notes ? ` · ${item.notes}` : ""}
                            {hint ? ` · ${hint.absolutePath}` : ""}
                          </Typography>
                        </Box>
                        {hint ? (
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={linkDiscovery.isPending}
                            onClick={() =>
                              linkDiscovery.mutate({
                                projectId: item.projectId,
                                workspaceRoot: hint.absolutePath,
                              })
                            }
                          >
                            {t("linkRoot")}
                          </Button>
                        ) : null}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>

            {candidates.length > 0 ? (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t("localCandidatesTitle")}
                </Typography>
                <Stack spacing={0.75}>
                  {candidates.map((candidate) => (
                    <Box
                      key={candidate.absolutePath}
                      sx={{
                        py: 1,
                        borderBottom: "1px solid rgba(20,32,34,0.06)",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 1,
                        alignItems: "center",
                      }}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {candidate.folderName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {candidate.absolutePath}
                          {candidate.fullName
                            ? ` · ${candidate.fullName}`
                            : ""}
                          {" · "}
                          {candidate.alreadyLinked
                            ? t("candidateLinked")
                            : candidate.registered && candidate.matchedSlug
                              ? t("candidateMatch", {
                                  slug: candidate.matchedSlug,
                                })
                              : t("candidateUnregistered")}
                        </Typography>
                      </Box>
                      {!candidate.alreadyLinked &&
                      candidate.matchedProjectId ? (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={linkDiscovery.isPending}
                          onClick={() =>
                            linkDiscovery.mutate({
                              projectId: candidate.matchedProjectId!,
                              workspaceRoot: candidate.absolutePath,
                            })
                          }
                        >
                          {t("linkRoot")}
                        </Button>
                      ) : null}
                      {!candidate.registered ? (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={importAndLink.isPending}
                          onClick={() =>
                            importAndLink.mutate({
                              folderName: candidate.folderName,
                              absolutePath: candidate.absolutePath,
                            })
                          }
                        >
                          {t("importAndLink")}
                        </Button>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Box>

      <Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography fontWeight={650}>{t("healthTitle")}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t("healthSubtitle")}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            onClick={() => portfolioHealth.mutate()}
            disabled={portfolioHealth.isPending}
          >
            {t("runHealth")}
          </Button>
        </Stack>
        {health && health.audited + health.skipped > 0 ? (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color={verdictColor(aggregate?.portfolioVerdict)}
                label={t("healthVerdict", {
                  verdict: aggregate?.portfolioVerdict ?? "UNKNOWN",
                })}
              />
              <EpistemicChip
                state={(health.epistemicState as EpistemicState) ?? "UNKNOWN"}
              />
            </Stack>
            <Typography variant="body2">
              {t("healthSummary", {
                audited: health.audited,
                skipped: health.skipped,
                avg: aggregate?.averageScore ?? health.averageScore ?? "—",
                worst: aggregate?.worstOfScore ?? "—",
                critical: aggregate?.criticalTotal ?? health.criticalTotal,
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("healthConstitution", {
                avg: aggregate?.constitutionAverage ?? "—",
                worst: aggregate?.constitutionWorst ?? "—",
              })}
              {" · "}
              {t("healthBlockers", {
                count: aggregate?.openBlockers ?? 0,
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {health.note}
              {health.asOf
                ? ` · ${t("healthLastRun", { asOf: health.asOf.slice(0, 19) })}`
                : null}
            </Typography>

            {aggregate && aggregate.worstDimensions.length > 0 ? (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t("healthWorstDims")}
                </Typography>
                <Stack spacing={0.5}>
                  {aggregate.worstDimensions.map((dim) => (
                    <Typography
                      key={dim.key}
                      variant="caption"
                      color="text.secondary"
                    >
                      {t("healthDimScore", {
                        key: dim.key,
                        score: dim.worstScore,
                        project: dim.projectName,
                      })}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            ) : null}

            {aggregate && aggregate.sharedPatterns.length > 0 ? (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                  {t("healthSharedPatterns")}
                </Typography>
                <Stack spacing={0.75}>
                  {aggregate.sharedPatterns.map((pattern) => (
                    <Box
                      key={pattern.key}
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr auto" },
                        gap: 1,
                        py: 0.5,
                        borderBottom: "1px solid rgba(20,32,34,0.06)",
                        minWidth: 0,
                      }}
                    >
                      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                        {pattern.title}
                      </Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          color={
                            pattern.severity === "CRITICAL"
                              ? "error"
                              : pattern.severity === "HIGH"
                                ? "warning"
                                : "default"
                          }
                          label={pattern.severity}
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          label={t("healthPatternProjects", {
                            count: pattern.projectCount,
                          })}
                          variant="outlined"
                        />
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}

            {health.items.map((item) => (
              <Box
                key={item.projectId}
                sx={{
                  py: 1,
                  borderBottom: "1px solid rgba(20,32,34,0.08)",
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr auto" },
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                    {item.notes}
                    {item.blockers && item.blockers.length > 0
                      ? ` · ${item.blockers
                          .slice(0, 2)
                          .map((b) => b.title)
                          .join(" · ")}`
                      : null}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    color={verdictColor(item.verdictHint)}
                    label={item.verdictHint ?? "UNKNOWN"}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={
                      item.overallScore != null
                        ? t("healthProjectScore", { score: item.overallScore })
                        : t("healthSkipped")
                    }
                    variant="outlined"
                  />
                  {item.constitutionScore != null ? (
                    <Chip
                      size="small"
                      label={t("healthProjectConstitution", {
                        score: item.constitutionScore,
                      })}
                      variant="outlined"
                    />
                  ) : null}
                  {item.criticalIssues > 0 ? (
                    <Chip
                      size="small"
                      color="error"
                      label={`${item.criticalIssues}`}
                    />
                  ) : null}
                </Stack>
              </Box>
            ))}
          </Stack>
        ) : null}
        {portfolioHealth.isError ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {(portfolioHealth.error as Error).message}
          </Typography>
        ) : null}
      </Box>

      <TextField
        label={t("repoLabel")}
        multiline
        minRows={5}
        value={repoList}
        onChange={(event) => setRepoList(event.target.value)}
        helperText={t("repoHelper")}
      />

      <Button
        variant="contained"
        onClick={() => discover.mutate()}
        disabled={discover.isPending}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("discover")}
      </Button>

      {discover.isSuccess ? (
        <Typography variant="body2">
          {t("discoverResult", {
            created: discover.data.created,
            updated: discover.data.updated,
          })}
        </Typography>
      ) : null}

      {uploadError ? (
        <Typography variant="body2" color="error">
          {uploadError}
        </Typography>
      ) : null}

      <Stack spacing={0}>
        {projectsLoading ? (
          <Stack spacing={1.5} sx={{ py: 1 }}>
            <Skeleton variant="rounded" height={72} />
            <Skeleton variant="rounded" height={72} />
            <Skeleton variant="rounded" height={72} />
          </Stack>
        ) : items.length === 0 ? (
          <Alert severity="info">
            <Typography fontWeight={650}>{t("empty")}</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("emptyHelp")}
            </Typography>
          </Alert>
        ) : (
          items.map((project) => {
            const overview = portfolioQuery.data?.projects.find(
              (item) => item.id === project.id,
            );
            const draft =
              rootDrafts[project.id] ?? project.workspaceRoot ?? "";
            const projectHealth = healthByProject.get(project.id);
            return (
              <Box
                key={project.id}
                sx={{
                  py: 2,
                  borderBottom: "1px solid rgba(20,32,34,0.12)",
                  display: "grid",
                  gap: 1.5,
                }}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr auto" },
                    gap: 2,
                    alignItems: { sm: "center" },
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={650}>{project.name}</Typography>
                      <Chip
                        size="small"
                        label={
                          project.cloudSynced
                            ? t("cloudSynced")
                            : t("localOnly")
                        }
                        variant="outlined"
                      />
                      {projectHealth?.verdictHint ? (
                        <Chip
                          size="small"
                          color={verdictColor(projectHealth.verdictHint)}
                          label={projectHealth.verdictHint}
                        />
                      ) : null}
                      {projectHealth?.overallScore != null ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t("healthProjectScore", {
                            score: projectHealth.overallScore,
                          })}
                        />
                      ) : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                      {project.slug}
                      {overview?.stateEpistemic
                        ? ` · state ${overview.stateEpistemic}`
                        : ` · ${t("stateUnknown")}`}
                      {project.workspaceRoot
                        ? ` · ${t("rootLinked")}`
                        : ` · ${t("rootMissing")}`}
                      {projectHealth?.constitutionScore != null
                        ? ` · ${t("healthProjectConstitution", {
                            score: projectHealth.constitutionScore,
                          })}`
                        : null}
                    </Typography>
                    {!project.workspaceRoot ? (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        {t("rootMissingHelp")}{" "}
                        <Link href="/workbench">{t("openWorkbench")}</Link>
                        {" · "}
                        <Link href="/process-audit">{t("openProcessAudit")}</Link>
                      </Alert>
                    ) : null}
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {!project.cloudSynced ? (
                      <Tooltip
                        title={
                          canUpload
                            ? t("uploadCloud")
                            : t("uploadCloudDisabledHint")
                        }
                      >
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!canUpload || uploadCloud.isPending}
                            onClick={() => uploadCloud.mutate(project.id)}
                          >
                            {t("uploadCloud")}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : null}
                    <Button
                      component={Link}
                      href="/studio"
                      size="small"
                      variant="contained"
                      disabled={!project.workspaceRoot}
                    >
                      {t("openStudio")}
                    </Button>
                    <Button
                      component={Link}
                      href="/workbench"
                      size="small"
                      variant="outlined"
                      disabled={!project.workspaceRoot}
                    >
                      {t("openWorkbench")}
                    </Button>
                    <Button
                      component={Link}
                      href={`/projects/${project.id}/state`}
                      size="small"
                      variant="outlined"
                    >
                      {t("openState")}
                    </Button>
                  </Stack>
                </Box>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ sm: "flex-start" }}
                >
                  <TextField
                    size="small"
                    fullWidth
                    label={t("workspaceRoot")}
                    value={draft}
                    onChange={(event) =>
                      setRootDrafts((prev) => ({
                        ...prev,
                        [project.id]: event.target.value,
                      }))
                    }
                    helperText={t("workspaceRootHelp")}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    disabled={saveRoot.isPending}
                    onClick={() =>
                      saveRoot.mutate({
                        projectId: project.id,
                        workspaceRoot: draft.trim() || null,
                      })
                    }
                    sx={{ whiteSpace: "nowrap", mt: { sm: 0.5 } }}
                  >
                    {t("saveRoot")}
                  </Button>
                </Stack>
              </Box>
            );
          })
        )}
      </Stack>
    </Stack>
  );
}
