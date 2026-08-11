"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { Link } from "@/i18n/routing";

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
  constitutionScore: number | null;
  epistemicState: string;
  notes: string;
}

interface PortfolioHealth {
  projectCount: number;
  audited: number;
  skipped: number;
  averageScore: number | null;
  criticalTotal: number;
  items: PortfolioHealthItem[];
  epistemicState: string;
  asOf: string;
  note: string;
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
    },
  });

  const portfolioHealth = useMutation({
    mutationFn: () => apiPost<PortfolioHealth>("/api/v1/portfolio/health", {}),
  });

  const items = projectsQuery.data?.items ?? [];
  const plan = planQuery.data;
  const canUpload =
    Boolean(plan?.cloudConfigured) && (plan?.remainingCloudSlots ?? 0) > 0;
  const health = portfolioHealth.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}{" "}
          <Link href="/integrations">{t("openIntegrations")}</Link>
          {" · "}
          <Link href="/plan">{t("viewPlan")}</Link>
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
          <EpistemicChip
            state={portfolioQuery.data?.epistemicState ?? "UNKNOWN"}
          />
          <Typography variant="body2">
            {t("registered", {
              count: portfolioQuery.data?.projectCount ?? 0,
            })}
          </Typography>
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
        {health ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography variant="body2">
              {t("healthSummary", {
                audited: health.audited,
                skipped: health.skipped,
                avg: health.averageScore ?? "—",
                critical: health.criticalTotal,
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {health.note}
            </Typography>
            {health.items.map((item) => (
              <Box
                key={item.projectId}
                sx={{
                  py: 1,
                  borderBottom: "1px solid rgba(20,32,34,0.08)",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 1,
                }}
              >
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.notes}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Chip
                    size="small"
                    label={
                      item.overallScore != null
                        ? `${item.overallScore}`
                        : t("healthSkipped")
                    }
                    variant="outlined"
                  />
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
        {items.length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          items.map((project) => {
            const overview = portfolioQuery.data?.projects.find(
              (item) => item.id === project.id,
            );
            const draft =
              rootDrafts[project.id] ?? project.workspaceRoot ?? "";
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
                    gridTemplateColumns: "1fr auto",
                    gap: 2,
                    alignItems: "center",
                  }}
                >
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
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
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {project.slug}
                      {overview?.stateEpistemic
                        ? ` · state ${overview.stateEpistemic}`
                        : ` · ${t("stateUnknown")}`}
                      {project.workspaceRoot
                        ? ` · ${t("rootLinked")}`
                        : ` · ${t("rootMissing")}`}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    {!project.cloudSynced ? (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!canUpload || uploadCloud.isPending}
                        onClick={() => uploadCloud.mutate(project.id)}
                      >
                        {t("uploadCloud")}
                      </Button>
                    ) : null}
                    <Button
                      component={Link}
                      href="/agent"
                      size="small"
                      variant="outlined"
                    >
                      {t("askAgent")}
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
