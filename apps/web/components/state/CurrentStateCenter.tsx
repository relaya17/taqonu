"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";
import type { EpistemicState } from "@atlas/shared";

interface Project {
  id: string;
  slug: string;
  name: string;
}

interface EvidenceItem {
  id: string;
  source: string;
  sourceType: string;
  category?: string;
  uri: string | null;
  excerpt: string | null;
  epistemicState: EpistemicState;
  observedAt: string;
}

interface EvidenceByCategory {
  category: string;
  items: EvidenceItem[];
}

interface StateSlice {
  key: string;
  summary: string;
  epistemicState: EpistemicState;
  confidence: number;
  evidenceIds: string[];
  asOf: string;
  stale: boolean;
}

interface CurrentState {
  id: string;
  projectId: string;
  asOf: string;
  reconciledAt: string;
  slices: StateSlice[];
  conflicts: Array<{ id: string; sliceKey: string; resolution: string | null }>;
  overallEpistemicState: EpistemicState;
  sourceConnectors: string[];
  evidence: EvidenceItem[];
  evidenceByCategory?: EvidenceByCategory[];
}

const SLICE_ORDER = [
  "CODE",
  "GIT",
  "ARCHITECTURE",
  "DEPENDENCIES",
  "DATABASE",
  "ENVIRONMENT",
  "DEPLOYMENT",
  "TESTS",
  "SECURITY",
  "DECISIONS",
  "TASKS",
  "RISKS",
] as const;

export function CurrentStateCenter({
  initialProjectId,
}: {
  initialProjectId?: string | null;
}) {
  const t = useTranslations("state");
  const tProjects = useTranslations("projects");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("projectId");

  const [projectId, setProjectId] = useState(
    () => initialProjectId ?? fromUrl ?? "",
  );

  useEffect(() => {
    const next = initialProjectId ?? fromUrl ?? "";
    if (next && next !== projectId) {
      setProjectId(next);
    }
  }, [initialProjectId, fromUrl, projectId]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const projects = projectsQuery.data?.items ?? [];

  useEffect(() => {
    if (!projectId && projects.length === 1) {
      setProjectId(projects[0]!.id);
    }
  }, [projectId, projects]);

  const stateQuery = useQuery({
    queryKey: ["project-state", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<CurrentState>(`/api/v1/projects/${projectId}/state`),
  });

  const [exportNote, setExportNote] = useState<string | null>(null);

  const reconcile = useMutation({
    mutationFn: () =>
      apiPost<CurrentState>(`/api/v1/projects/${projectId}/state/reconcile`, {
        reason: "ui-reconcile",
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["project-state", projectId], data);
      void queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    },
  });

  const exportContext = useMutation({
    mutationFn: () =>
      apiGet<{ markdown: string; epistemicState: string }>(
        `/api/v1/projects/${projectId}/context-export`,
      ),
    onSuccess: async (data) => {
      try {
        await navigator.clipboard.writeText(data.markdown);
        setExportNote(t("exportCopied"));
      } catch {
        setExportNote(t("exportReady"));
      }
    },
  });

  const evidenceById = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    for (const item of stateQuery.data?.evidence ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [stateQuery.data?.evidence]);

  const slices = useMemo(() => {
    const items = stateQuery.data?.slices ?? [];
    const byKey = new Map(items.map((s) => [s.key, s]));
    return SLICE_ORDER.map((key) => byKey.get(key)).filter(
      (s): s is StateSlice => Boolean(s),
    );
  }, [stateQuery.data?.slices]);

  const selected = projects.find((p) => p.id === projectId);

  return (
    <Stack spacing={3} sx={{ maxWidth: 880 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ sm: "center" }}
      >
        <TextField
          select
          fullWidth
          size="small"
          label={t("project")}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          helperText={
            projects.length === 0 ? tProjects("empty") : t("projectHelp")
          }
        >
          {projects.length === 0 ? (
            <MenuItem value="" disabled>
              {t("noProjects")}
            </MenuItem>
          ) : (
            projects.map((project) => (
              <MenuItem key={project.id} value={project.id}>
                {project.name} ({project.slug})
              </MenuItem>
            ))
          )}
        </TextField>
        <Button
          variant="contained"
          disabled={!projectId || reconcile.isPending}
          onClick={() => reconcile.mutate()}
          sx={{ whiteSpace: "nowrap", alignSelf: { xs: "stretch", sm: "center" } }}
        >
          {t("reconcile")}
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          disabled={!projectId || exportContext.isPending}
          onClick={() => {
            setExportNote(null);
            exportContext.mutate();
          }}
          sx={{ whiteSpace: "nowrap", alignSelf: { xs: "stretch", sm: "center" } }}
        >
          {t("exportEditors")}
        </Button>
      </Stack>
      {exportNote ? (
        <Alert severity="success" onClose={() => setExportNote(null)}>
          {exportNote}
        </Alert>
      ) : null}
      {exportContext.isError ? (
        <Alert severity="error">{(exportContext.error as Error).message}</Alert>
      ) : null}

      {!projectId ? (
        <Alert severity="info">
          {t("pickProject")}{" "}
          <MuiLink component={Link} href="/projects">
            {t("goProjects")}
          </MuiLink>
        </Alert>
      ) : null}

      {stateQuery.isError ? (
        <Alert severity="error">{(stateQuery.error as Error).message}</Alert>
      ) : null}

      {stateQuery.data ? (
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography fontWeight={650}>
              {selected?.name ?? stateQuery.data.projectId}
            </Typography>
            <EpistemicChip state={stateQuery.data.overallEpistemicState} />
            {stateQuery.data.conflicts.length > 0 ? (
              <Chip
                size="small"
                color="warning"
                label={t("conflictCount", {
                  count: stateQuery.data.conflicts.length,
                })}
                component={Link}
                href="/conflicts"
                clickable
              />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("reconciledAt", {
              at: stateQuery.data.reconciledAt.slice(0, 19),
            })}
            {stateQuery.data.sourceConnectors.length > 0
              ? ` · ${t("connectors", {
                  list: stateQuery.data.sourceConnectors.join(", "),
                })}`
              : ` · ${t("noConnectors")}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("honesty")}
          </Typography>

          {(stateQuery.data.evidenceByCategory ?? []).some(
            (bucket) => bucket.items.length > 0,
          ) ? (
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 0.5 }}
              aria-label={t("byCategory")}
            >
              <Typography variant="caption" fontWeight={600} sx={{ mr: 0.5 }}>
                {t("byCategory")}:
              </Typography>
              {(stateQuery.data.evidenceByCategory ?? [])
                .filter((bucket) => bucket.items.length > 0)
                .map((bucket) => (
                  <Chip
                    key={bucket.category}
                    size="small"
                    variant="outlined"
                    label={`${t(`slices.${bucket.category}` as "slices.CODE")} · ${bucket.items.length}`}
                  />
                ))}
            </Stack>
          ) : null}

          <Stack spacing={0}>
            {slices.map((slice) => {
              const evidenceItems = slice.evidenceIds
                .map((id) => evidenceById.get(id))
                .filter((item): item is EvidenceItem => Boolean(item));

              return (
                <Box
                  key={slice.key}
                  sx={{
                    py: 2,
                    borderBottom: "1px solid rgba(20,32,34,0.12)",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography fontWeight={650}>
                      {t(`slices.${slice.key}` as "slices.CODE")}
                    </Typography>
                    <EpistemicChip state={slice.epistemicState} />
                    {slice.stale ? (
                      <Chip size="small" label={t("stale")} variant="outlined" />
                    ) : null}
                    {slice.key === "TESTS" ? (
                      <Chip
                        size="small"
                        label={t("ciNote")}
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75 }}>
                    {slice.summary}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    {t("asOf", { at: slice.asOf.slice(0, 19) })}
                    {` · ${t("confidence", {
                      value: Math.round(slice.confidence * 100),
                    })}`}
                  </Typography>

                  {evidenceItems.length === 0 ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: "block" }}
                    >
                      {t("noEvidence")}
                    </Typography>
                  ) : (
                    <Stack spacing={0.75} sx={{ mt: 1.25 }}>
                      <Typography variant="caption" fontWeight={600}>
                        {t("evidence")}
                      </Typography>
                      {evidenceItems.map((item) => (
                        <Box key={item.id}>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                          >
                            <Chip
                              size="small"
                              label={t(
                                `slices.${(item.category ?? slice.key) as "CODE"}` as "slices.CODE",
                              )}
                              variant="outlined"
                            />
                            <Chip
                              size="small"
                              label={item.sourceType}
                              variant="outlined"
                            />
                            <EpistemicChip state={item.epistemicState} />
                            {item.uri ? (
                              <MuiLink
                                href={item.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="body2"
                              >
                                {item.source}
                              </MuiLink>
                            ) : (
                              <Typography variant="body2">
                                {item.source}
                              </Typography>
                            )}
                          </Stack>
                          {item.excerpt ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: "block", mt: 0.25 }}
                            >
                              {item.excerpt.slice(0, 240)}
                              {item.excerpt.length > 240 ? "…" : ""}
                            </Typography>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Stack>
      ) : null}

      {projectId && stateQuery.isLoading ? (
        <Typography color="text.secondary">{t("loading")}</Typography>
      ) : null}
    </Stack>
  );
}
