"use client";

import { useMemo, useState } from "react";
import { useProjectQueryParam } from "@/lib/use-project-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { OnboardingPath } from "@/components/onboarding/OnboardingPath";
import { PersonalDesk } from "@/components/dashboard/PersonalDesk";
import { ResponsiveActions } from "@/components/layout/ResponsiveActions";
import { Suspense } from "react";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface BlockerItem {
  id: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  evidenceRefs: string[];
}

interface Verdict {
  status: "READY" | "CONDITIONAL" | "BLOCKED" | "UNKNOWN";
  productionReadiness: number;
  criticalBlockers: number;
  highRisks: number;
  unverifiedClaims: number;
  verifiedClaims: number;
  evidenceCoverage: number;
  projectName: string;
  projectId: string;
  plainLanguageSummary: string;
  confidence: number;
  blockerItems: BlockerItem[];
}

interface EvidenceReport {
  id: string;
  markdown: string;
  sections: { title: string; body: string }[];
}

export default function DashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [selectedId, setSelectedId] = useProjectQueryParam("");
  const [showReport, setShowReport] = useState(false);
  const [showExecutive, setShowExecutive] = useState(false);

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const systems = useQuery({
    queryKey: ["managed-systems"],
    queryFn: () =>
      apiGet<{
        items: {
          id: string;
          projectId: string | null;
          name: string;
          posture: "CLEAR" | "WATCH" | "BLOCKED" | "UNKNOWN";
        }[];
      }>("/api/v1/systems"),
    staleTime: 30_000,
  });
  const blockedSystems = (systems.data?.items ?? []).filter(
    (row) => row.posture === "BLOCKED",
  );

  const golden = useQuery({
    queryKey: ["golden-project"],
    queryFn: () =>
      apiGet<{ workspaceRoot: string; slug: string; exists: boolean }>(
        "/api/v1/golden/project",
      ),
    staleTime: 5 * 60_000,
  });

  const byo = useQuery({
    queryKey: ["byo-cloud-status"],
    queryFn: () =>
      apiGet<{
        status: "connected" | "disconnected" | "error";
        accountLabel: string | null;
        provider: string;
      }>("/api/v1/byo-cloud/status"),
    staleTime: 60_000,
  });

  const projectId = useMemo(() => {
    if (selectedId) return selectedId;
    const items = projects.data?.items ?? [];
    const broker = items.find((p) => p.slug === "brokeros");
    const byGolden = items.find((p) => p.slug === golden.data?.slug);
    return broker?.id ?? byGolden?.id ?? items[0]?.id ?? "";
  }, [selectedId, projects.data, golden.data?.slug]);

  const verdict = useQuery({
    queryKey: ["verdict", projectId, golden.data?.workspaceRoot, locale],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("locale", locale === "ar" ? "ar" : locale === "he" ? "he" : "en");
      if (
        golden.data?.workspaceRoot &&
        projects.data?.items.find((p) => p.id === projectId)?.slug ===
          (golden.data?.slug ?? "brokeros")
      ) {
        params.set("workspaceRoot", golden.data.workspaceRoot);
      }
      return apiGet<Verdict>(
        `/api/v1/projects/${projectId}/verdict?${params.toString()}`,
      );
    },
  });

  const report = useQuery({
    queryKey: ["report", projectId, showReport, locale],
    enabled: Boolean(projectId) && showReport,
    staleTime: 60_000,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("locale", locale === "ar" ? "ar" : locale === "he" ? "he" : "en");
      if (
        golden.data?.workspaceRoot &&
        projects.data?.items.find((p) => p.id === projectId)?.slug ===
          (golden.data?.slug ?? "brokeros")
      ) {
        params.set("workspaceRoot", golden.data.workspaceRoot);
      }
      return apiGet<EvidenceReport>(
        `/api/v1/projects/${projectId}/report?${params.toString()}`,
      );
    },
  });

  const executive = useQuery({
    queryKey: ["executive-report", projectId, showExecutive, locale],
    enabled: Boolean(projectId) && showExecutive,
    staleTime: 60_000,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("locale", locale === "ar" ? "ar" : locale === "he" ? "he" : "en");
      if (
        golden.data?.workspaceRoot &&
        projects.data?.items.find((p) => p.id === projectId)?.slug ===
          (golden.data?.slug ?? "brokeros")
      ) {
        params.set("workspaceRoot", golden.data.workspaceRoot);
      }
      return apiGet<EvidenceReport>(
        `/api/v1/projects/${projectId}/executive-report?${params.toString()}`,
      );
    },
  });

  const statusColor =
    verdict.data?.status === "READY"
      ? "success"
      : verdict.data?.status === "BLOCKED"
        ? "error"
        : "warning";

  const statusLabel = (status: Verdict["status"]) => {
    const key = `dashboard.status.${status}` as const;
    return t.has(key) ? t(key) : status;
  };

  const severityLabel = (severity: BlockerItem["severity"]) => {
    const key = `dashboard.severity.${severity}` as const;
    return t.has(key) ? t(key) : severity;
  };

  const downloadMarkdown = (markdown: string | undefined, kind: "report" | "executive") => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-${kind}-${verdict.data?.projectName ?? "project"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        maxWidth: 920,
        width: "100%",
        minWidth: 0,
        textAlign: "center",
      }}
    >
      <Box>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: "2rem", sm: "2.2rem", md: "3rem" },
            mb: 1,
            wordBreak: "break-word",
            animation: "atlasIn 700ms ease both",
            "@keyframes atlasIn": {
              from: { opacity: 0, transform: "translateY(12px)" },
              to: { opacity: 1, transform: "translateY(0)" },
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
          }}
        >
          {t("brand.name")}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 640, mx: "auto", mb: 2 }}>
          {t("dashboard.pitch")}
        </Typography>
        <OnboardingPath
          missingRootCount={(projects.data?.items ?? []).filter(
            (p) => !p.workspaceRoot,
          ).length}
        />
        {blockedSystems.length > 0 ? (
          <Alert
            severity="error"
            sx={{ mt: 2, mb: 1 }}
            action={
              <Button component={Link} href="/systems" color="inherit" size="small">
                {t("dashboard.ctaSystems")}
              </Button>
            }
          >
            {t("dashboard.blockedSystems", { count: blockedSystems.length })}
            {": "}
            {blockedSystems.map((row) => row.name).join(", ")}
          </Alert>
        ) : null}
        <Alert
          severity={byo.data?.status === "connected" ? "success" : "info"}
          sx={{ mt: 2, mb: 1 }}
          action={
            <Button component={Link} href="/plan" color="inherit" size="small">
              {t("dashboard.byoCta")}
            </Button>
          }
        >
          {byo.isLoading
            ? t("dashboard.byoLoading")
            : byo.data?.status === "connected"
              ? t("dashboard.byoConnected", {
                  label: byo.data.accountLabel ?? "Cloudflare",
                })
              : t("dashboard.byoDisconnected")}
        </Alert>
        <ResponsiveActions sx={{ mt: 2 }}>
          <Button component={Link} href="/systems" variant="contained" size="large">
            {t("dashboard.ctaSystems")}
          </Button>
          <Button component={Link} href="/projects" variant="outlined" size="large">
            {t("dashboard.ctaProjects")}
          </Button>
          <Button component={Link} href="/studio" variant="outlined" size="large">
            {t("dashboard.ctaStudio")}
          </Button>
          <Button component={Link} href="/agents" variant="outlined" size="large">
            {t("dashboard.ctaAgents")}
          </Button>
          <Button component={Link} href="/experts" variant="outlined" size="large">
            {t("dashboard.ctaPartners")}
          </Button>
          <Button component={Link} href="/legal-media" variant="outlined" size="large">
            {t("dashboard.ctaCounsel")}
          </Button>
          <Button component={Link} href="/readiness" variant="text" size="large">
            {t("dashboard.ctaReadiness")}
          </Button>
        </ResponsiveActions>
        <Box sx={{ mt: 1.25, display: "flex", justifyContent: "center" }}>
          <EpistemicChip state="INFERRED" />
        </Box>
      </Box>

      <Box>
        <Typography fontWeight={700}>{t("dashboard.opsTitle")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("dashboard.opsHelp")}
        </Typography>
        <ResponsiveActions compact sx={{ mt: 1.5 }}>
          <Button component={Link} href="/health" size="small" variant="outlined">
            {t("dashboard.opsHealth")}
          </Button>
          <Button component={Link} href="/readiness" size="small" variant="outlined">
            {t("dashboard.opsReadiness")}
          </Button>
          <Button component={Link} href="/qa" size="small" variant="outlined">
            {t("dashboard.opsQa")}
          </Button>
          <Button
            component={Link}
            href="/process-audit"
            size="small"
            variant="outlined"
          >
            {t("dashboard.opsProcessAudit")}
          </Button>
          <Button component={Link} href="/legal-media" size="small" variant="outlined">
            {t("dashboard.opsCounsel")}
          </Button>
        </ResponsiveActions>
      </Box>

      {projects.isLoading ? (
        <Skeleton variant="rounded" height={56} sx={{ maxWidth: 420, mx: "auto", width: "100%" }} />
      ) : (
        <TextField
          select
          size="small"
          label={t("dashboard.projectSelect")}
          value={projectId}
          onChange={(e) => setSelectedId(e.target.value)}
          sx={{
            maxWidth: 420,
            mx: "auto",
            width: "100%",
            "& .MuiSelect-select": { textAlign: "center" },
            "& .MuiFormHelperText-root": { textAlign: "center", mx: 0 },
          }}
          helperText={t("dashboard.projectSelectHelp")}
        >
          {(projects.data?.items ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name} ({p.slug})
            </MenuItem>
          ))}
        </TextField>
      )}

      {verdict.isError ? (
        <Alert severity="warning">{t("dashboard.verdictUnavailable")}</Alert>
      ) : null}

      {!projectId && !projects.isLoading ? (
        <Alert severity="info">
          {t("dashboard.noProjects")}{" "}
          <Button component={Link} href="/experts" size="small">
            {t("dashboard.ctaPartners")}
          </Button>
        </Alert>
      ) : null}

      {projectId && (verdict.isLoading || verdict.isFetching) && !verdict.data ? (
        <Box sx={{ py: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
          <Skeleton width={220} height={24} />
          <Box sx={{ display: "flex", justifyContent: "center", gap: 2 }}>
            <Skeleton width={96} height={56} />
            <Skeleton width={100} height={32} />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1, flexWrap: "wrap" }}>
            <Skeleton width={88} height={28} />
            <Skeleton width={88} height={28} />
            <Skeleton width={88} height={28} />
          </Box>
        </Box>
      ) : null}

      {verdict.data ? (
        <Box
          sx={{
            py: 3,
            width: "100%",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            borderTop: "1px solid rgba(26,31,42,0.14)",
            borderBottom: "1px solid rgba(26,31,42,0.14)",
          }}
        >
          <Typography variant="overline" color="text.secondary">
            {verdict.data.projectName} · {t("dashboard.releaseLabel")}
          </Typography>
          <Box
            sx={{
              mt: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.25,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "center",
                gap: 1,
              }}
            >
              <Typography sx={{ fontSize: "3rem", fontWeight: 700, lineHeight: 1 }}>
                {verdict.data.productionReadiness}
              </Typography>
              <Typography color="text.secondary">/ 100</Typography>
            </Box>
            <Chip
              color={statusColor}
              label={statusLabel(verdict.data.status)}
              sx={{ fontWeight: 700 }}
            />
          </Box>
          <Box
            sx={{
              mt: 2,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 1,
              width: "100%",
            }}
          >
            <Chip
              size="small"
              color="error"
              component={Link}
              href="/readiness"
              clickable
              label={`${verdict.data.criticalBlockers} ${t("dashboard.blockersChip")}`}
            />
            <Chip
              size="small"
              color="warning"
              component={Link}
              href="/readiness"
              clickable
              label={`${verdict.data.highRisks} ${t("dashboard.highRisksChip")}`}
            />
            <Chip
              size="small"
              label={`${verdict.data.unverifiedClaims} ${t("dashboard.unverifiedChip")}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`${verdict.data.verifiedClaims} ${t("dashboard.verifiedChip")}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t("dashboard.evidenceChip", {
                n: Math.round(verdict.data.evidenceCoverage * 100),
              })}
            />
          </Box>

          {verdict.data.blockerItems.length > 0 ? (
            <Box
              sx={{
                mt: 2,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Typography fontWeight={700}>{t("dashboard.blockersTitle")}</Typography>
              {verdict.data.blockerItems.slice(0, 8).map((b) => (
                <Box
                  key={b.id}
                  sx={{
                    py: 1,
                    width: "100%",
                    textAlign: "center",
                    borderBottom: "1px solid rgba(26,31,42,0.08)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 1,
                    }}
                  >
                    <Chip
                      size="small"
                      color={b.severity === "CRITICAL" ? "error" : "warning"}
                      label={severityLabel(b.severity)}
                    />
                    <Typography variant="body2">{b.title}</Typography>
                  </Box>
                  {b.evidenceRefs[0] ? (
                    <Typography variant="caption" color="text.secondary">
                      {t("dashboard.evidenceLabel")} {b.evidenceRefs[0]}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : null}

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, lineHeight: 1.65 }}>
            {t("dashboard.verdictSummary", {
              score: verdict.data.productionReadiness,
              blockers: verdict.data.criticalBlockers,
              high: verdict.data.highRisks,
              unverified: verdict.data.unverifiedClaims,
            })}
          </Typography>
          <ResponsiveActions compact sx={{ mt: 2 }}>
            <Button component={Link} href="/readiness" size="small" variant="outlined">
              {t("dashboard.viewCertificate")}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => setShowReport(true)}
            >
              {t("dashboard.viewReport")}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowExecutive(true)}
            >
              {t("dashboard.viewExecutive")}
            </Button>
            {showReport && report.data ? (
              <Button
                size="small"
                variant="text"
                onClick={() => downloadMarkdown(report.data?.markdown, "report")}
              >
                {t("dashboard.downloadReport")}
              </Button>
            ) : null}
            {showExecutive && executive.data ? (
              <Button
                size="small"
                variant="text"
                onClick={() => downloadMarkdown(executive.data?.markdown, "executive")}
              >
                {t("dashboard.downloadExecutive")}
              </Button>
            ) : null}
          </ResponsiveActions>

          {showReport && report.data ? (
            <Box
              component="pre"
              sx={{
                mt: 2,
                p: 2,
                bgcolor: "rgba(26,31,42,0.04)",
                overflow: "auto",
                maxHeight: 320,
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {report.data.markdown}
            </Box>
          ) : null}
          {showReport && report.isError ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t("dashboard.reportUnavailable")}
            </Alert>
          ) : null}
          {showExecutive && executive.data ? (
            <Box
              component="pre"
              sx={{
                mt: 2,
                p: 2,
                bgcolor: "rgba(26,31,42,0.04)",
                overflow: "auto",
                maxHeight: 320,
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {executive.data.markdown}
            </Box>
          ) : null}
          {showExecutive && executive.isError ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t("dashboard.reportUnavailable")}
            </Alert>
          ) : null}
        </Box>
      ) : projectId ? (
        <Typography color="text.secondary">{t("dashboard.loadingVerdict")}</Typography>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        {t("dashboard.workersNote")}
      </Typography>

      <Suspense fallback={null}>
        <PersonalDesk />
      </Suspense>
    </Box>
  );
}
