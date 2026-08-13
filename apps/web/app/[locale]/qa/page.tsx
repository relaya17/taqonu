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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

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
    summary: string;
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
  portfolioPatterns: Array<{
    id: string;
    patternKey: string;
    title: string;
    summary: string;
  }>;
  regressionRulesTriggered: Array<{
    id: string;
    patternKey: string;
    title: string;
  }>;
  learnedPatternKeys?: string[];
  emittedPatternKeys?: string[];
  contextPatterns?: Array<{
    id: string;
    patternKey: string;
    title: string;
  }>;
  memoryContext?: {
    contextPatternCount?: number;
    patternLessons?: string[];
  };
}

interface PatternsResponse {
  items: Array<{
    id: string;
    patternKey: string;
    title: string;
    summary: string;
    severity: string;
    domain: string;
    projectIds?: string[];
  }>;
  learnedPatternKeys: string[];
  crossProjectCount?: number;
  storedCount?: number;
  total?: number;
}

interface RunsResponse {
  items: Array<{ id: string }>;
  learnedPatternKeys: string[];
}

const PROFILES = [
  "PROCESS_INTERNAL",
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

const APP_PROFILES = [
  "AUTO",
  "GENERIC",
  "SAAS",
  "ECOMMERCE",
  "MARKETPLACE",
  "CONTENT",
  "FINTECH",
  "HEALTH",
  "EDTECH",
  "HOTEL",
] as const;

interface ProcessAuditDocument {
  id: string;
  appProfile: string;
  appProfileSource: string;
  verdict: "GO" | "CONDITIONAL_GO" | "NO_GO";
  verdictReason: string;
  specialistsEngaged: string[];
  sections: {
    executiveSummary: string;
    defects: string[];
    blockers: string[];
    futureChecks: string[];
    recommendations: string[];
  };
  markdownReport: string;
}

function extractPatternKey(summary: string): string | null {
  const match = /\[pattern:([^\]]+)\]/.exec(summary);
  return match?.[1] ?? null;
}

export default function QaPage() {
  const t = useTranslations("qa");
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<
    "SINGLE_PROJECT" | "SELECTED_PROJECTS" | "ENTIRE_PORTFOLIO"
  >("SINGLE_PROJECT");
  const [profile, setProfile] = useState<(typeof PROFILES)[number]>(
    "PROCESS_INTERNAL",
  );
  const [appProfile, setAppProfile] =
    useState<(typeof APP_PROFILES)[number]>("AUTO");
  const [projectId, setProjectId] = useState("");
  const [request, setRequest] = useState("");
  const [report, setReport] = useState<QaReport | null>(null);
  const [processDoc, setProcessDoc] = useState<ProcessAuditDocument | null>(
    null,
  );

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const runsQuery = useQuery({
    queryKey: ["qa", "runs"],
    queryFn: () => apiGet<RunsResponse>("/api/v1/qa/runs"),
  });

  const patternsQuery = useQuery({
    queryKey: ["qa", "patterns"],
    queryFn: () => apiGet<PatternsResponse>("/api/v1/qa/patterns"),
  });

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const learnedKeys = useMemo(() => {
    const fromRuns = runsQuery.data?.learnedPatternKeys ?? [];
    const fromPatterns = patternsQuery.data?.learnedPatternKeys ?? [];
    const fromReport = report?.learnedPatternKeys ?? [];
    return [...new Set([...fromRuns, ...fromPatterns, ...fromReport])];
  }, [runsQuery.data, patternsQuery.data, report]);

  const portfolioPatterns = patternsQuery.data?.items ?? [];
  const portfolioPatternCount =
    patternsQuery.data?.crossProjectCount ?? portfolioPatterns.length;

  const invalidateLearn = () => {
    void queryClient.invalidateQueries({ queryKey: ["qa"] });
  };

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
    onSuccess: (data) => {
      setReport(data);
      setProcessDoc(null);
      invalidateLearn();
    },
  });

  const processMutation = useMutation({
    mutationFn: () =>
      apiPost<ProcessAuditDocument>("/api/v1/qa/process-audit", {
        projectId: projectId || null,
        appProfile: appProfile === "AUTO" ? null : appProfile,
        userRequest: request || t("processDefaultRequest"),
        environment: "LOCAL",
        includeProviders: true,
        includeUiUx: true,
        includePerformance: true,
      }),
    onSuccess: (data) => {
      setProcessDoc(data);
      setReport(null);
    },
  });

  const learnMutation = useMutation({
    mutationFn: (patternKey: string) =>
      apiPost<{ learnedPatternKeys: string[] }>("/api/v1/qa/learn", {
        patternKey,
      }),
    onSuccess: invalidateLearn,
  });

  const unlearnMutation = useMutation({
    mutationFn: (patternKey: string) =>
      apiDelete<{ learnedPatternKeys: string[] }>("/api/v1/qa/learn", {
        patternKey,
      }),
    onSuccess: invalidateLearn,
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

      <Alert severity="info">{t("processIntro")}</Alert>

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
              {p === "PROCESS_INTERNAL" ? t("profileProcessInternal") : p}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t("appProfile")}
          value={appProfile}
          onChange={(e) =>
            setAppProfile(e.target.value as (typeof APP_PROFILES)[number])
          }
          sx={{ minWidth: 200 }}
          helperText={t("appProfileHelp")}
        >
          {APP_PROFILES.map((p) => (
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

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Button
          variant="contained"
          onClick={() => processMutation.mutate()}
          disabled={processMutation.isPending}
        >
          {processMutation.isPending ? t("processRunning") : t("processRun")}
        </Button>
        <Button
          variant="outlined"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {t("run")}
        </Button>
      </Stack>

      {mutation.isError ? (
        <Alert severity="error">{(mutation.error as Error).message}</Alert>
      ) : null}
      {processMutation.isError ? (
        <Alert severity="error">
          {(processMutation.error as Error).message}
        </Alert>
      ) : null}

      {processDoc ? (
        <Box sx={{ borderTop: "1px solid rgba(26,31,42,0.14)", pt: 2.5 }}>
          <Typography variant="overline">{t("processReport")}</Typography>
          <Alert
            severity={
              processDoc.verdict === "GO"
                ? "success"
                : processDoc.verdict === "CONDITIONAL_GO"
                  ? "warning"
                  : "error"
            }
            sx={{ mt: 1, mb: 2 }}
          >
            <Typography fontWeight={700}>
              {t(`verdict_${processDoc.verdict}`)} — {processDoc.appProfile} (
              {processDoc.appProfileSource})
            </Typography>
            <Typography variant="body2">{processDoc.verdictReason}</Typography>
          </Alert>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("specialists")}: {processDoc.specialistsEngaged.join(" · ")}
          </Typography>

          {processDoc.sections.blockers.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline">{t("blockers")}</Typography>
              {processDoc.sections.blockers.map((b) => (
                <Typography key={b} variant="body2">
                  • {b}
                </Typography>
              ))}
            </Box>
          ) : null}

          {processDoc.sections.defects.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline">{t("defects")}</Typography>
              {processDoc.sections.defects.map((d) => (
                <Typography key={d} variant="body2">
                  • {d}
                </Typography>
              ))}
            </Box>
          ) : null}

          {processDoc.sections.recommendations.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline">{t("recommendations")}</Typography>
              {processDoc.sections.recommendations.map((r) => (
                <Typography key={r} variant="body2">
                  • {r}
                </Typography>
              ))}
            </Box>
          ) : null}

          <Button
            size="small"
            variant="outlined"
            onClick={async () => {
              await navigator.clipboard.writeText(processDoc.markdownReport);
            }}
          >
            {t("copyMarkdown")}
          </Button>
        </Box>
      ) : null}

      <Box sx={{ borderTop: "1px solid rgba(26,31,42,0.14)", pt: 2.5 }}>
        <Typography variant="overline">{t("learnedKeys")}</Typography>
        {learnedKeys.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("noLearnedKeys")}
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {learnedKeys.map((key) => (
              <Box
                key={key}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                  py: 0.5,
                }}
              >
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {key}
                </Typography>
                <Button
                  size="small"
                  onClick={() => unlearnMutation.mutate(key)}
                  disabled={unlearnMutation.isPending}
                >
                  {t("unlearn")}
                </Button>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Box>
        <Typography variant="overline">
          {t("patterns")} · {t("patternsCount", { count: portfolioPatternCount })}
        </Typography>
        {portfolioPatterns.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("noPatterns")}
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {portfolioPatterns.map((p) => {
              const learned = learnedKeys.includes(p.patternKey);
              const projectCount = p.projectIds?.length ?? 0;
              return (
                <Box
                  key={p.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 1.5,
                    alignItems: "start",
                    py: 1,
                    borderBottom: "1px solid rgba(26,31,42,0.08)",
                  }}
                >
                  <Box>
                    <Typography fontWeight={600}>{p.title}</Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: "monospace" }}
                    >
                      {p.patternKey}
                      {projectCount > 0
                        ? ` · ${t("patternProjects", { count: projectCount })}`
                        : ""}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {p.summary}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant={learned ? "outlined" : "contained"}
                    onClick={() =>
                      learned
                        ? unlearnMutation.mutate(p.patternKey)
                        : learnMutation.mutate(p.patternKey)
                    }
                    disabled={
                      learnMutation.isPending || unlearnMutation.isPending
                    }
                  >
                    {learned ? t("unlearn") : t("learn")}
                  </Button>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {report?.memoryContext?.contextPatternCount ? (
        <Alert severity="info">
          {t("contextPatternsHint", {
            count: report.memoryContext.contextPatternCount,
          })}
        </Alert>
      ) : null}

      {report ? (
        <Box sx={{ borderTop: "1px solid rgba(26,31,42,0.14)", pt: 2.5 }}>
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

          {report.regressionRulesTriggered.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline">{t("regressions")}</Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {report.regressionRulesTriggered.map((r) => (
                  <Typography key={r.id} variant="body2">
                    • {r.title}{" "}
                    <Box
                      component="span"
                      sx={{ fontFamily: "monospace", opacity: 0.7 }}
                    >
                      ({r.patternKey})
                    </Box>
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}

          <Typography variant="overline">{t("findings")}</Typography>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {report.findings.slice(0, 12).map((f) => {
              const patternKey = extractPatternKey(f.summary);
              const learned =
                patternKey != null && learnedKeys.includes(patternKey);
              return (
                <Box
                  key={f.id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 1.5,
                    alignItems: "center",
                    py: 1,
                    borderBottom: "1px solid rgba(26,31,42,0.08)",
                  }}
                >
                  <EpistemicChip state={f.epistemicState} />
                  <Box>
                    <Typography fontWeight={600}>
                      [{f.severity}] {f.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {f.domain}
                      {patternKey ? ` · ${patternKey}` : ""}
                    </Typography>
                  </Box>
                  {patternKey ? (
                    <Button
                      size="small"
                      onClick={() =>
                        learned
                          ? unlearnMutation.mutate(patternKey)
                          : learnMutation.mutate(patternKey)
                      }
                      disabled={
                        learnMutation.isPending || unlearnMutation.isPending
                      }
                    >
                      {learned ? t("unlearn") : t("learn")}
                    </Button>
                  ) : null}
                </Box>
              );
            })}
          </Stack>

          {report.portfolioPatterns.length > 0 ? (
            <Box sx={{ mt: 3 }}>
              <Typography variant="overline">{t("runPatterns")}</Typography>
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
