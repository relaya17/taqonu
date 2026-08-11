"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";

interface Project {
  id: string;
  name: string;
}

interface QaReport {
  run: {
    id: string;
    scope: string;
    profile: string;
    environment: string;
    status: string;
    severityCounts: {
      CRITICAL: number;
      HIGH: number;
      MEDIUM: number;
      LOW: number;
    };
    scorecard: {
      testCoveragePercent: number | null;
      criticalPathsTestedPercent: number | null;
      securityReadinessPercent: number | null;
      productionReadinessPercent: number | null;
      evidenceSignalCount: number;
      inferredSignalCount: number;
    } | null;
    topRiskTitles: string[];
    domainsPlanned: string[];
    writeGateLocked: boolean;
  };
  findings: Array<{
    id: string;
    title: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    domain: string;
    epistemicState:
      | "FACT"
      | "CONFIRMED"
      | "INFERRED"
      | "PROPOSED"
      | "UNKNOWN"
      | "CONFLICTED";
  }>;
  portfolioPatterns: Array<{ id: string; title: string; summary: string }>;
}

const PROFILES = [
  "QUICK",
  "STANDARD",
  "DEEP",
  "SECURITY",
  "REGRESSION",
  "PRE_DEPLOY",
  "PRODUCTION_SAFE",
  "PORTFOLIO",
  "FULL_AUDIT",
  "CHANGED_ONLY",
] as const;

export default function QaPage() {
  const t = useTranslations("qa");
  const [scope, setScope] = useState<
    "SINGLE_PROJECT" | "SELECTED_PROJECTS" | "ENTIRE_PORTFOLIO"
  >("SINGLE_PROJECT");
  const [profile, setProfile] = useState<(typeof PROFILES)[number]>("STANDARD");
  const [projectId, setProjectId] = useState("");
  const [request, setRequest] = useState("");
  const [report, setReport] = useState<QaReport | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<QaReport>("/api/v1/qa/runs", {
        scope,
        profile,
        environment: profile === "PRODUCTION_SAFE" ? "PRODUCTION_SAFE" : "LOCAL",
        projectId: scope === "SINGLE_PROJECT" ? projectId || null : null,
        projectIds:
          scope === "SELECTED_PROJECTS" && projectId ? [projectId] : undefined,
        userRequest: request || t("defaultRequest"),
      }),
    onSuccess: setReport,
  });

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

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          select
          label={t("scope")}
          value={scope}
          onChange={(e) =>
            setScope(e.target.value as typeof scope)
          }
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="SINGLE_PROJECT">{t("scopeSingle")}</MenuItem>
          <MenuItem value="SELECTED_PROJECTS">{t("scopeSelected")}</MenuItem>
          <MenuItem value="ENTIRE_PORTFOLIO">{t("scopePortfolio")}</MenuItem>
        </TextField>
        <TextField
          select
          label={t("profile")}
          value={profile}
          onChange={(e) =>
            setProfile(e.target.value as (typeof PROFILES)[number])
          }
          sx={{ minWidth: 220 }}
        >
          {PROFILES.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>
        {scope !== "ENTIRE_PORTFOLIO" ? (
          <TextField
            select
            label={t("project")}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            sx={{ minWidth: 220 }}
            helperText={projects.length === 0 ? t("noProjects") : undefined}
          >
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
      </Stack>

      <TextField
        multiline
        minRows={2}
        fullWidth
        label={t("request")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={t("placeholder")}
      />

      <Button
        variant="contained"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("run")}
      </Button>

      {mutation.isError ? (
        <Alert severity="error">{(mutation.error as Error).message}</Alert>
      ) : null}

      {report ? (
        <Box sx={{ borderTop: "1px solid rgba(20,32,34,0.14)", pt: 2.5 }}>
          <Typography variant="overline">{t("severity")}</Typography>
          <Typography sx={{ mb: 2 }}>
            CRITICAL {report.run.severityCounts.CRITICAL} · HIGH{" "}
            {report.run.severityCounts.HIGH} · MEDIUM{" "}
            {report.run.severityCounts.MEDIUM} · LOW{" "}
            {report.run.severityCounts.LOW}
          </Typography>

          {report.run.scorecard ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("scorecardHint", {
                evidence: report.run.scorecard.evidenceSignalCount,
                inferred: report.run.scorecard.inferredSignalCount,
              })}
            </Typography>
          ) : null}

          <Typography variant="overline">{t("domains")}</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {report.run.domainsPlanned.join(" · ")}
          </Typography>

          <Typography variant="overline">{t("topRisks")}</Typography>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            {(report.run.topRiskTitles.length
              ? report.run.topRiskTitles
              : [t("noRisksYet")]
            ).map((title) => (
              <Typography key={title} variant="body2">
                • {title}
              </Typography>
            ))}
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            {t("writeGate")}
          </Alert>

          <Typography variant="overline">{t("findings")}</Typography>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {report.findings.slice(0, 12).map((f) => (
              <Box
                key={f.id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: 1.5,
                  alignItems: "center",
                  py: 1,
                  borderBottom: "1px solid rgba(20,32,34,0.08)",
                }}
              >
                <EpistemicChip state={f.epistemicState} />
                <Box>
                  <Typography fontWeight={600}>
                    [{f.severity}] {f.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {f.domain}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>

          {report.portfolioPatterns.length > 0 ? (
            <Box sx={{ mt: 3 }}>
              <Typography variant="overline">{t("patterns")}</Typography>
              {report.portfolioPatterns.map((p) => (
                <Typography key={p.id} variant="body2" sx={{ mt: 1 }}>
                  {p.title} — {p.summary}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
