"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface Dimension {
  key: string;
  score: number;
  epistemicState: string;
  notes: string;
  evidenceRefs: string[];
}

interface Certificate {
  id: string;
  projectId: string | null;
  projectName: string;
  overallScore: number;
  dimensions: Dimension[];
  blockers: number;
  highRisks: number;
  unknownClaims: number;
  blockerSummaries: string[];
  highRiskSummaries: string[];
  unknownSummaries: string[];
  lastVerifiedAt: string;
  plainLanguageSummary: string;
}

export default function ReadinessPage() {
  const t = useTranslations("readiness");
  const tEp = useTranslations("epistemic");
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const golden = useQuery({
    queryKey: ["golden-project"],
    queryFn: () =>
      apiGet<{ workspaceRoot: string; slug: string; exists: boolean }>(
        "/api/v1/golden/project",
      ),
    staleTime: 5 * 60_000,
  });

  const projectId = useMemo(() => {
    if (selectedId) return selectedId;
    const items = projects.data?.items ?? [];
    const broker = items.find((p) => p.slug === "brokeros");
    return broker?.id ?? items[0]?.id ?? "";
  }, [selectedId, projects.data]);

  const selected = projects.data?.items.find((p) => p.id === projectId);

  const list = useQuery({
    queryKey: ["readiness-certs"],
    queryFn: () =>
      apiGet<{ items: Certificate[] }>("/api/v1/readiness/certificates"),
    staleTime: 30_000,
  });

  const issue = useMutation({
    mutationFn: () =>
      apiPost<{ certificate: Certificate }>("/api/v1/readiness/certificate", {
        projectId: projectId || null,
        projectName: selected?.name,
        workspaceRoot:
          selected?.slug === (golden.data?.slug ?? "brokeros")
            ? golden.data?.workspaceRoot
            : undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["readiness-certs"] });
      await queryClient.invalidateQueries({ queryKey: ["verdict"] });
    },
  });

  const cert =
    issue.data?.certificate ??
    list.data?.items?.find((c) => c.projectId === projectId) ??
    list.data?.items?.[0];

  const epistemicLabel = (state: string) => {
    try {
      return tEp(state as "OBSERVED");
    } catch {
      return state;
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 920, width: "100%" }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info">{t("positioning")}</Alert>

      <TextField
        select
        size="small"
        label={t("projectSelect")}
        value={projectId}
        onChange={(e) => setSelectedId(e.target.value)}
        fullWidth
        sx={{ maxWidth: 420 }}
      >
        {(projects.data?.items ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name} ({p.slug})
            {p.workspaceRoot ? "" : " · —"}
          </MenuItem>
        ))}
      </TextField>

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selected?.workspaceRoot}
          compact
        />
      ) : null}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Button
          variant="contained"
          disabled={!projectId || issue.isPending}
          onClick={() => issue.mutate()}
          sx={{ minHeight: 44 }}
        >
          {t("issue")}
        </Button>
        <Button
          component={Link}
          href="/"
          size="medium"
          variant="outlined"
          sx={{ minHeight: 44 }}
        >
          {t("openVerdict")}
        </Button>
        <Button
          component={Link}
          href="/partners"
          size="medium"
          variant="text"
          sx={{ minHeight: 44 }}
        >
          {t("importRepo")}
        </Button>
      </Stack>

      {issue.isError ? (
        <Alert severity="error">{(issue.error as Error).message}</Alert>
      ) : null}

      {cert ? (
        <Box>
          <Typography variant="h2" sx={{ fontSize: { xs: "1.35rem", sm: "1.6rem" } }}>
            {cert.projectName} · {cert.overallScore}/100
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color="error"
              label={`${cert.blockers} ${t("blockers")}`}
            />
            <Chip
              size="small"
              color="warning"
              label={`${cert.highRisks} ${t("highShort")}`}
            />
            <Chip
              size="small"
              label={`${cert.unknownClaims} ${t("unknownShort")}`}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, lineHeight: 1.65 }}>
            {t("summary", {
              name: cert.projectName,
              score: cert.overallScore,
              blockers: cert.blockers,
              high: cert.highRisks,
              unknown: cert.unknownClaims,
            })}
          </Typography>

          <Stack spacing={2} sx={{ mt: 3 }}>
            {cert.dimensions.map((d) => (
              <Box key={d.key}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  gap={1}
                  sx={{ cursor: "pointer" }}
                  onClick={() =>
                    setExpandedDim(expandedDim === d.key ? null : d.key)
                  }
                >
                  <Typography fontWeight={600}>
                    {t(`dim.${d.key}` as "dim.security")}
                  </Typography>
                  <Typography sx={{ flexShrink: 0 }}>
                    {d.score} · {epistemicLabel(d.epistemicState)}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={d.score}
                  sx={{ mt: 0.5, height: 8, borderRadius: 1 }}
                />
                {expandedDim === d.key ? (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2">{d.notes}</Typography>
                    {d.evidenceRefs.length > 0 ? (
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        <Typography variant="caption" fontWeight={700}>
                          {t("evidence")}
                        </Typography>
                        {d.evidenceRefs.map((ref) => (
                          <Typography
                            key={ref}
                            variant="caption"
                            color="text.secondary"
                          >
                            ← {ref}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {t("noEvidence")}
                      </Typography>
                    )}
                  </Box>
                ) : null}
              </Box>
            ))}
          </Stack>

          {cert.blockerSummaries.length > 0 ? (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight={700}>{t("blockers")}</Typography>
              {cert.blockerSummaries.map((s) => (
                <Typography key={s} variant="body2">
                  • {s}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : (
        <Typography color="text.secondary">{t("empty")}</Typography>
      )}
    </Stack>
  );
}
