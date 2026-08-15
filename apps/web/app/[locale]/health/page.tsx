"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import { useProjectQueryParam } from "@/lib/use-project-query";

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

interface Issue {
  id: string;
  category: string;
  severity: string;
  title: string;
  rootCause: string;
  recommendedFix: string;
  remediationPolicy: string;
  confidence: number;
  architectureViolation: boolean;
  omission?: boolean;
  constitutionDomain?: string | null;
  evidence: { ref: string; note: string }[];
}

interface HealthReport {
  id: string;
  projectName: string;
  overallScore: number;
  dimensions: Dimension[];
  criticalIssues: number;
  highRisk: number;
  medium: number;
  low: number;
  architectureDriftScore: number;
  issues: Issue[];
  plainLanguageSummary: string;
  pillars: { understand: string; detect: string; remediate: string };
  constitution?: {
    overallScore: number;
    detectedProfiles: string[];
    domainScores: {
      domain: string;
      score: number;
      applicable: number;
      failed: number;
    }[];
    omissionCount: number;
    failedChecks: number;
  } | null;
}

export default function SystemHealthPage() {
  const t = useTranslations("health");
  const tEp = useTranslations("epistemic");
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useProjectQueryParam("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [intent, setIntent] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const golden = useQuery({
    queryKey: ["golden-project"],
    queryFn: () =>
      apiGet<{ workspaceRoot: string; slug: string }>(
        "/api/v1/golden/project",
      ),
    staleTime: 5 * 60_000,
  });

  const projectId = useMemo(() => {
    if (selectedId) return selectedId;
    const items = projects.data?.items ?? [];
    return items.find((p) => p.slug === "brokeros")?.id ?? items[0]?.id ?? "";
  }, [selectedId, projects.data]);

  const selected = projects.data?.items.find((p) => p.id === projectId);

  const list = useQuery({
    queryKey: ["audit-reports"],
    queryFn: () =>
      apiGet<{ items: HealthReport[] }>("/api/v1/audit-engine/reports"),
    staleTime: 30_000,
  });

  const run = useMutation({
    mutationFn: () => {
      const goldenSlug = golden.data?.slug ?? "brokeros";
      const root =
        selected?.workspaceRoot ||
        (selected?.slug === goldenSlug
          ? golden.data?.workspaceRoot
          : undefined);
      return apiPost<HealthReport>("/api/v1/audit-engine/run", {
        projectId: projectId || null,
        ...(selected?.name ? { projectName: selected.name } : { projectName: "Repository" }),
        ...(root ? { workspaceRoot: root } : {}),
        ...(intent.trim() ? { intent: intent.trim() } : {}),
        includeConstitution: true,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["audit-reports"] });
    },
  });

  const report = run.data ?? list.data?.items?.[0];

  const sevLabel = (s: string) => {
    try {
      return t(`severity.${s}` as "severity.CRITICAL");
    } catch {
      return s;
    }
  };

  const policyLabel = (s: string) => {
    try {
      return t(`policy.${s}` as "policy.AUTO_FIX");
    } catch {
      return s;
    }
  };

  const domainLabel = (d: string) => {
    try {
      return t(`domain.${d}` as "domain.ARCHITECTURE");
    } catch {
      return d;
    }
  };

  const profileLabel = (p: string) => {
    try {
      return t(`profile.${p}` as "profile.SAAS");
    } catch {
      return p;
    }
  };

  const categoryLabel = (c: string) => {
    try {
      return t(`category.${c}` as "category.SECURITY");
    } catch {
      return c;
    }
  };

  const sevColor = (s: string) =>
    s === "CRITICAL" ? "error" : s === "HIGH" ? "warning" : "default";

  return (
    <Stack spacing={3} sx={{ maxWidth: 960, width: "100%", px: { xs: 0.5, sm: 0 } }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.6 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        {t("pillars")}
      </Alert>

      <TextField
        select
        size="small"
        label={t("project")}
        value={projectId}
        onChange={(e) => setSelectedId(e.target.value)}
        fullWidth
        sx={{ maxWidth: 480 }}
        disabled={projects.isLoading}
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

      <TextField
        size="small"
        label={t("intent")}
        placeholder={t("intentPlaceholder")}
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        fullWidth
        sx={{ maxWidth: 640 }}
        helperText={t("intentHelp")}
        InputLabelProps={{ shrink: true }}
      />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Button
          variant="contained"
          disabled={run.isPending}
          onClick={() => run.mutate()}
          sx={{ minHeight: 44 }}
        >
          {run.isPending ? t("running") : t("runAudit")}
        </Button>
        <Button
          component={Link}
          href="/readiness"
          size="medium"
          variant="outlined"
          sx={{ minHeight: 44 }}
        >
          {t("openReadiness")}
        </Button>
        <Button
          component={Link}
          href="/"
          size="medium"
          variant="text"
          sx={{ minHeight: 44 }}
        >
          {t("openVerdict")}
        </Button>
        <Button
          component={Link}
          href="/projects"
          size="medium"
          variant="text"
          sx={{ minHeight: 44 }}
        >
          {t("openPortfolio")}
        </Button>
      </Stack>

      {projects.isError ? (
        <Alert severity="warning">{(projects.error as Error).message}</Alert>
      ) : null}
      {run.isError ? (
        <Alert severity="error">{(run.error as Error).message}</Alert>
      ) : null}

      {report ? (
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
            {report.projectName} · {t("systemHealth")}
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            alignItems="baseline"
            sx={{ mt: 1 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Typography sx={{ fontSize: { xs: "2.5rem", sm: "3rem" }, fontWeight: 700, lineHeight: 1 }}>
              {report.overallScore}
            </Typography>
            <Typography color="text.secondary">/ 100</Typography>
            <Chip
              size="small"
              color="info"
              label={`${t("drift")} ${report.architectureDriftScore}`}
            />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color="error"
              label={`${report.criticalIssues} ${t("critical")}`}
            />
            <Chip
              size="small"
              color="warning"
              label={`${report.highRisk} ${t("high")}`}
            />
            <Chip size="small" label={`${report.medium} ${t("medium")}`} />
            <Chip
              size="small"
              variant="outlined"
              label={`${report.low} ${t("low")}`}
            />
          </Stack>

          {report.constitution ? (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight={700}>{t("constitution")}</Typography>
              <Stack
                direction="row"
                spacing={1}
                alignItems="baseline"
                sx={{ mt: 1 }}
                flexWrap="wrap"
                useFlexGap
              >
                <Typography sx={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1 }}>
                  {report.constitution.overallScore}
                </Typography>
                <Typography color="text.secondary">/ 100</Typography>
                <Chip
                  size="small"
                  color="secondary"
                  label={`${report.constitution.omissionCount} ${t("omissions")}`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${report.constitution.failedChecks} ${t("failedChecks")}`}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {t("profiles")}:{" "}
                {report.constitution.detectedProfiles
                  .filter((p) => p !== "ALL")
                  .map((p) => profileLabel(p))
                  .join(", ") || t("allProfiles")}
              </Typography>
              <Stack spacing={1.25} sx={{ mt: 2 }}>
                {report.constitution.domainScores
                  .filter((d) => d.applicable > 0)
                  .map((d) => (
                    <Box key={d.domain}>
                      <Stack direction="row" justifyContent="space-between" gap={1}>
                        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                          {domainLabel(d.domain)}
                        </Typography>
                        <Typography variant="body2" sx={{ flexShrink: 0 }}>
                          {d.score}
                          {d.failed > 0 ? ` · ${d.failed}` : ""}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={d.score}
                        sx={{ mt: 0.5, height: 6, borderRadius: 1 }}
                      />
                    </Box>
                  ))}
              </Stack>
            </Box>
          ) : null}

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, lineHeight: 1.6 }}>
            {t("systemHealth")} {report.overallScore}/100.{" "}
            {report.criticalIssues} {t("critical")} · {report.highRisk} {t("high")} ·{" "}
            {report.medium} {t("medium")} · {report.low} {t("low")}.{" "}
            {t("drift")} {report.architectureDriftScore}/100
            {report.constitution
              ? ` · ${t("constitution")} ${report.constitution.overallScore}/100 · ${report.constitution.omissionCount} ${t("omissions")}`
              : ""}
            .
          </Typography>

          <Stack spacing={2} sx={{ mt: 3 }}>
            {report.dimensions.map((d) => (
              <Box key={d.key}>
                <Stack direction="row" justifyContent="space-between" gap={1}>
                  <Typography fontWeight={600}>
                    {t(`dim.${d.key}` as "dim.architecture")}
                  </Typography>
                  <Typography sx={{ flexShrink: 0 }}>
                    {d.score} ·{" "}
                    {(() => {
                      try {
                        return tEp(d.epistemicState as "OBSERVED");
                      } catch {
                        return d.epistemicState;
                      }
                    })()}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={d.score}
                  sx={{ mt: 0.5, height: 8, borderRadius: 1 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {d.notes}
                  {d.evidenceRefs[0] ? ` · ${d.evidenceRefs[0]}` : ""}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Typography fontWeight={700} sx={{ mt: 4 }}>
            {t("issues")}
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {report.issues.slice(0, 25).map((i) => {
              const isOpen = expanded === i.id;
              return (
              <ButtonBase
                key={i.id}
                focusRipple
                onClick={() => setExpanded(isOpen ? null : i.id)}
                aria-expanded={isOpen}
                aria-controls={`issue-detail-${i.id}`}
                sx={{
                  display: "block",
                  width: "100%",
                  textAlign: "start",
                  py: 1.5,
                  borderRadius: 1,
                  borderBottom: "1px solid rgba(26,31,42,0.1)",
                  color: "inherit",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" color={sevColor(i.severity)} label={sevLabel(i.severity)} />
                  <Chip size="small" variant="outlined" label={categoryLabel(i.category)} />
                  <Chip size="small" label={policyLabel(i.remediationPolicy)} />
                  {i.architectureViolation ? (
                    <Chip size="small" color="error" label={t("archDriftTag")} />
                  ) : null}
                  {i.omission ? (
                    <Chip size="small" color="secondary" label={t("omissionTag")} />
                  ) : null}
                  {i.constitutionDomain ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={domainLabel(i.constitutionDomain)}
                    />
                  ) : null}
                </Stack>
                <Typography variant="body2" fontWeight={600} sx={{ mt: 1, lineHeight: 1.45 }}>
                  {i.title}
                </Typography>
                {isOpen ? (
                  <Box id={`issue-detail-${i.id}`} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      <strong>{t("rootCause")}:</strong> {i.rootCause}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      <strong>{t("fix")}:</strong> {i.recommendedFix}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {Math.round(i.confidence * 100)}%
                      {i.evidence[0]
                        ? ` · ${i.evidence[0].ref}: ${i.evidence[0].note}`
                        : ""}
                    </Typography>
                  </Box>
                ) : null}
              </ButtonBase>
              );
            })}
          </Stack>

          <Box sx={{ mt: 3 }}>
            <Typography fontWeight={700}>{t("remediationPolicy")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
              {t("remediationLegend")}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Typography color="text.secondary">{t("empty")}</Typography>
      )}
    </Stack>
  );
}
