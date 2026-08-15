"use client";

import { useState } from "react";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";
import { ResponsiveActions } from "@/components/layout/ResponsiveActions";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";
import type { EpistemicState } from "@atlas/shared";

interface Project {
  id: string;
  name: string;
  workspaceRoot?: string | null;
}

interface Finding {
  id: string;
  area: string;
  status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  severity: string;
  title: string;
  note: string;
  fixHint: string;
  epistemicState: EpistemicState;
}

interface Source {
  id: string;
  titleEn: string;
  titleHe: string;
  url: string;
  kind: string;
  region: string;
}

interface Review {
  lawyerReadiness: "READY_FOR_COUNSEL" | "NEEDS_FIXES" | "INSUFFICIENT_EVIDENCE";
  summaryEn: string;
  summaryHe: string;
  disclaimerEn: string;
  disclaimerHe: string;
  disclaimerAr: string;
  findings: Finding[];
  counselTopics: string[];
  verifiedSources: Source[];
  epistemicState: EpistemicState;
  notALawyer: true;
  briefMarkdown: string;
}

interface VerdictLite {
  status: string;
  productionReadiness: number;
  criticalBlockers: number;
  highRisks: number;
  unverifiedClaims: number;
  plainLanguageSummary: string;
}

export default function LegalMediaPage() {
  const t = useTranslations("legalMedia");
  const locale = useLocale();
  const [projectId, setProjectId] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const sources = useQuery({
    queryKey: ["legal-media-sources"],
    queryFn: () => apiGet<{ items: Source[] }>("/api/v1/legal-media/sources"),
  });

  const selected = (projects.data?.items ?? []).find((p) => p.id === projectId);

  const verdict = useQuery({
    queryKey: ["verdict", projectId, locale],
    queryFn: () => apiGet<VerdictLite>(`/api/v1/projects/${projectId}/verdict`),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

  const review = useMutation({
    mutationFn: () =>
      apiPost<Review>("/api/v1/legal-media/review", {
        projectId: projectId || null,
      }),
  });

  const data = review.data;
  const disclaimer =
    locale === "he"
      ? data?.disclaimerHe
      : locale === "ar"
        ? data?.disclaimerAr
        : data?.disclaimerEn;
  const summary = locale === "he" ? data?.summaryHe : data?.summaryEn;

  const findingTitle = (f: Finding) => {
    const key = `finding.${f.id}`;
    return t.has(key) ? t(key) : f.title;
  };

  const download = () => {
    if (!data?.briefMarkdown) return;
    const extra = verdict.data
      ? [
          "",
          "## Release verdict (engineering — not a legal opinion)",
          "",
          `${verdict.data.status} · ${verdict.data.productionReadiness}/100`,
          "",
          verdict.data.plainLanguageSummary,
          "",
          `Critical blockers: ${verdict.data.criticalBlockers} · High risks: ${verdict.data.highRisks} · Unverified claims: ${verdict.data.unverifiedClaims}`,
          "",
        ].join("\n")
      : "";
    const blob = new Blob([`${data.briefMarkdown}${extra}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-counsel-brief-${selected?.name ?? "project"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack
      spacing={3}
      sx={{ maxWidth: 880, width: "100%", mx: "auto", textAlign: "center" }}
    >
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", md: "2.4rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 640, mx: "auto" }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="warning">{t("disclaimer")}</Alert>
      <Alert severity="info">{t("audience")}</Alert>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        justifyContent="center"
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <TextField
          select
          fullWidth
          label={t("project")}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          helperText={t("projectHelp")}
          sx={{ maxWidth: 480 }}
        >
          <MenuItem value="">{t("pickProject")}</MenuItem>
          {(projects.data?.items ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selected?.workspaceRoot}
          compact
        />
      ) : null}

      <ResponsiveActions>
        <Button
          variant="contained"
          disabled={review.isPending}
          onClick={() => review.mutate()}
        >
          {review.isPending ? t("running") : t("run")}
        </Button>
        {data ? (
          <Button variant="outlined" onClick={download}>
            {t("download")}
          </Button>
        ) : null}
        <Button component={Link} href="/partners" variant="text">
          {t("openAudit")}
        </Button>
      </ResponsiveActions>

      {review.isError ? (
        <Alert severity="error">{(review.error as Error).message}</Alert>
      ) : null}

      {verdict.data ? (
        <Alert severity="info">
          {t("verdictAttach", {
            status: verdict.data.status,
            score: verdict.data.productionReadiness,
          })}
        </Alert>
      ) : null}

      {data ? (
        <Stack spacing={2} sx={{ width: "100%" }}>
          <Alert severity="info">{disclaimer}</Alert>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <Chip
              label={t(`readiness_${data.lawyerReadiness}` as "readiness_NEEDS_FIXES")}
              color={
                data.lawyerReadiness === "READY_FOR_COUNSEL"
                  ? "success"
                  : data.lawyerReadiness === "NEEDS_FIXES"
                    ? "warning"
                    : "default"
              }
            />
            <EpistemicChip state={data.epistemicState} />
            <Chip size="small" label={t("notLawyerChip")} variant="outlined" />
          </Box>
          <Typography>{summary}</Typography>

          <Typography fontWeight={650}>{t("findings")}</Typography>
          <Stack spacing={1.5}>
            {data.findings.map((f) => (
              <Box
                key={f.id}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  p: 1.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    flexWrap: "wrap",
                    gap: 1,
                    alignItems: "center",
                  }}
                >
                  <Typography fontWeight={600}>{findingTitle(f)}</Typography>
                  <Chip size="small" label={f.status} />
                  <Chip size="small" label={f.severity} variant="outlined" />
                  <EpistemicChip state={f.epistemicState} />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {f.note}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {t("fixHint")}: {f.fixHint}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Typography fontWeight={650}>{t("counselTopics")}</Typography>
          <Stack component="ul" sx={{ m: 0, ps: 2, textAlign: "start" }}>
            {data.counselTopics.map((topic) => (
              <Typography component="li" key={topic} variant="body2">
                {topic}
              </Typography>
            ))}
          </Stack>
        </Stack>
      ) : null}

      <Box>
        <Typography fontWeight={650} sx={{ mb: 1 }}>
          {t("sourcesTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("sourcesHelp")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("jurisdictions")}
        </Typography>
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 1.5,
          }}
        >
          {(["IL", "EU", "US", "INTL"] as const).map((region) => {
            const count = (
              sources.data?.items ??
              data?.verifiedSources ??
              []
            ).filter((s) => s.region === region).length;
            if (count === 0) return null;
            return (
              <Chip
                key={region}
                size="small"
                variant="outlined"
                label={t("regionCount", {
                  region: t(`region_${region}` as "region_IL"),
                  count,
                })}
              />
            );
          })}
        </Box>
        <Stack spacing={0.75}>
          {(sources.data?.items ?? data?.verifiedSources ?? []).map((s) => (
            <Typography key={s.id} variant="body2">
              <MuiLink href={s.url} target="_blank" rel="noopener noreferrer">
                {locale === "he" ? s.titleHe : s.titleEn}
              </MuiLink>
              {` · ${s.kind} · ${s.region}`}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
