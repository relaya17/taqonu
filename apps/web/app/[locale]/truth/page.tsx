"use client";

import { useMemo } from "react";
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
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";
import { useProjectQueryParam } from "@/lib/use-project-query";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface Finding {
  id: string;
  title: string;
  detail: string;
  claim: string;
  epistemicState: string;
  riskBand: string;
  category: string;
  evidenceRefs?: string[];
}

interface TruthCounters {
  analyzed: number;
  meaningfulRisks: number;
  confirmedRegressions: number;
  caughtBeforeProd: number;
  cycles: number;
}

interface HistoryEntry {
  id: string;
  at: string;
  riskBand: string;
  trigger: string;
  topFindingTitle: string | null;
  behaviorDiffCount: number;
}

interface ObserveResult {
  id: string;
  workspaceRoot: string;
  previousGenomeAt: string | null;
  risk: { score: number; band: string; summary: string };
  findings: Finding[];
  bugs: { id: string; title: string; severity: string; status: string; claim: string }[];
  behaviorDiffs: { title: string; detail: string; riskBand: string }[];
  genome: { apis: unknown[]; architecture: { fileCount: number } };
  counters: TruthCounters;
  history: HistoryEntry[];
}

interface GraphPage {
  total: number;
  edgesTotal: number;
  builtAt: string | null;
  note: string;
}

function scoreFromRisk(band: string, raw: number): number {
  const capped = Math.max(0, Math.min(100, 100 - Math.round(raw / 30)));
  if (band === "CRITICAL") return Math.min(capped, 45);
  if (band === "HIGH") return Math.min(capped, 62);
  if (band === "MEDIUM") return Math.min(capped, 78);
  return Math.max(capped, 86);
}

function ScoreRail({
  label,
  value,
  delayMs,
}: {
  label: string;
  value: number;
  delayMs: number;
}) {
  return (
    <Box
      sx={{
        animation: `truthRise 700ms ${delayMs}ms both`,
        "@keyframes truthRise": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={700}>
          {value}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{
          height: 8,
          borderRadius: 999,
          bgcolor: "rgba(232,234,238,0.12)",
          "& .MuiLinearProgress-bar": {
            borderRadius: 999,
            bgcolor: value >= 90 ? "#9A9EA8" : value >= 75 ? "#E0B15A" : "#E07A5F",
          },
        }}
      />
    </Box>
  );
}

export default function TruthPage() {
  const t = useTranslations("truth");
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useProjectQueryParam("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const firstId = projects.data?.items[0]?.id ?? "";
  const activeId = selectedId || firstId;

  const state = useQuery({
    queryKey: ["observer-state", activeId],
    enabled: Boolean(activeId),
    queryFn: () =>
      apiGet<{
        counters: TruthCounters;
        history: HistoryEntry[];
        snapshots?: { file: string; capturedAt: string; apiCount: number }[];
        expectedCompare?: {
          expectedFlowCount: number;
          observedFlowCount: number;
          driftCount: number;
          promotedAt: string | null;
          source: string | null;
          drifts: { title: string; riskBand: string; beforeSteps: string[]; afterSteps: string[] }[];
        };
        p1Signals?: {
          authEdges: number;
          sensitiveEdges: number;
          decisionNodes: number;
          decidedByEdges?: number;
          identityNodes?: number;
          dataStoreNodes?: number;
          deploymentNodes?: number;
          packageNodes?: number;
          advisoryIncidents?: number;
          adrConflicts: number;
          productionPresent: number;
          productionMissing: number;
          missingTitles: string[];
          sentinelPosture?: string;
          sentinelCritical?: number;
          sentinelHigh?: number;
          sentinelSecrets?: number;
          sentinelAuthz?: number;
          sentinelDeps?: number;
          sentinelConfig?: number;
          isolationDenied?: number;
          isolationBound?: number;
          isolationAuditTotal?: number;
          lastDeploy?: {
            provider: string;
            environment: string;
            status: string;
            observedAt: string;
          } | null;
        };
        error?: string | null;
      }>(`/api/v1/projects/${activeId}/observer`),
  });

  const graph = useQuery({
    queryKey: ["graph-nodes", activeId],
    enabled: Boolean(activeId),
    queryFn: () =>
      apiGet<GraphPage>(
        `/api/v1/graph/nodes?projectId=${activeId}&pageSize=1`,
      ),
  });

  const cycle = useMutation({
    mutationFn: () =>
      apiPost<ObserveResult>(`/api/v1/projects/${activeId}/observe-cycle`, {
        trigger: "manual",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["graph-nodes", activeId] });
      void queryClient.invalidateQueries({ queryKey: ["observer-state", activeId] });
    },
  });

  const promote = useMutation({
    mutationFn: () =>
      apiPut<{ expected: unknown }>(
        `/api/v1/projects/${activeId}/observer/expected`,
        { mode: "promote_observed" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["observer-state", activeId] });
    },
  });

  const proposeFix = useMutation({
    mutationFn: (finding: Finding) =>
      apiPost<{ draft: { patch: { id: string }; applyBlocked: boolean }; note: string }>(
        "/api/v1/remediation/from-truth",
        {
          projectId: activeId,
          finding: {
            id: finding.id,
            title: finding.title,
            detail: finding.detail,
            riskBand: finding.riskBand,
            claim: finding.claim,
            epistemicState: finding.epistemicState,
            evidenceRefs: finding.evidenceRefs ?? [],
            category: finding.category,
          },
        },
      ),
  });

  const result = cycle.data;
  const counters = result?.counters ?? state.data?.counters;
  const history = result?.history ?? state.data?.history ?? [];
  const linkError = state.data?.error ?? null;
  const activeProject =
    projects.data?.items.find((p) => p.id === activeId) ?? null;
  const expectedCompare = state.data?.expectedCompare;
  const snapshots = state.data?.snapshots ?? [];
  const p1Signals = state.data?.p1Signals;
  const scores = useMemo(() => {
    if (!result) {
      return {
        software: graph.data?.total ? 88 : 0,
        behavior: 0,
        security: p1Signals?.sensitiveEdges
          ? Math.max(50, 92 - p1Signals.sensitiveEdges * 6)
          : 0,
        architecture: 0,
        tests: 0,
      };
    }
    const base = scoreFromRisk(result.risk.band, result.risk.score);
    const drifts = result.behaviorDiffs.length;
    const openBugs = result.bugs.filter(
      (b) => b.status === "OPEN" || b.status === "REPRODUCED",
    ).length;
    const sensitive = p1Signals?.sensitiveEdges ?? 0;
    const sentinelHit =
      (p1Signals?.sentinelCritical ?? 0) + (p1Signals?.sentinelHigh ?? 0);
    return {
      software: base,
      behavior: Math.max(40, 100 - drifts * 12 - (p1Signals?.adrConflicts ?? 0) * 8),
      security: Math.max(
        40,
        96 - openBugs * 8 - sensitive * 5 - sentinelHit * 7,
      ),
      architecture: Math.min(
        95,
        70 + Math.min(20, Math.floor((graph.data?.edgesTotal ?? 0) / 15)),
      ),
      tests: result.genome.architecture.fileCount > 0 ? 82 : 55,
    };
  }, [result, graph.data, p1Signals]);

  const topFinding =
    result?.findings
      .filter((f) => {
        if (f.id.startsWith("behavior-")) return true;
        if (f.id.startsWith("adr-conflict-")) return true;
        if (f.id.startsWith("sentinel:") && f.riskBand !== "LOW") return true;
        if (f.id === "sentinel-posture" && f.riskBand !== "LOW") return true;
        if (f.id === "security-graph" && f.riskBand !== "LOW") return true;
        if (f.id === "production-intelligence" && f.riskBand !== "LOW") return true;
        if (f.id === "production-deploy" && f.riskBand !== "LOW") return true;
        if (f.category === "BUG" && f.riskBand !== "LOW") return true;
        if (f.category === "SECURITY" && f.riskBand !== "LOW") return true;
        return false;
      })
      .sort((a, b) => {
        const rank = (x: string) =>
          x === "CRITICAL" ? 4 : x === "HIGH" ? 3 : x === "MEDIUM" ? 2 : 1;
        const weight = (id: string) =>
          id.startsWith("adr-conflict-")
            ? 4
            : id.startsWith("sentinel:")
              ? 3
              : id.startsWith("behavior-")
                ? 2
                : id.startsWith("bug-")
                  ? 1
                  : 0;
        const band = rank(b.riskBand) - rank(a.riskBand);
        return band !== 0 ? band : weight(b.id) - weight(a.id);
      })[0] ?? null;

  const critical = counters?.meaningfulRisks ?? 0;
  const drifts = result?.behaviorDiffs.length ?? 0;
  const analyzed = counters?.analyzed ?? 0;
  const verified = counters?.caughtBeforeProd ?? 0;

  return (
    <Box
      sx={{
        minHeight: "70vh",
        mx: { xs: -2, sm: -3, md: -4 },
        px: { xs: 2, sm: 3, md: 4 },
        py: { xs: 2, md: 3 },
        background: `
          radial-gradient(1200px 500px at 10% -10%, rgba(154,158,168,0.22), transparent 55%),
          radial-gradient(900px 420px at 100% 0%, rgba(28,31,38,0.55), transparent 50%),
          linear-gradient(165deg, #12141A 0%, #1C1F26 48%, #2A2E36 100%)
        `,
        color: "#DCDDE1",
        borderRadius: { xs: 0, md: 3 },
      }}
    >
      <Stack spacing={3} sx={{ maxWidth: 980, width: "100%" }}>
        <Box
          sx={{
            animation: "truthFade 800ms both",
            "@keyframes truthFade": {
              from: { opacity: 0, transform: "translateY(8px)" },
              to: { opacity: 1, transform: "none" },
            },
          }}
        >
          <Typography
            component="p"
            sx={{
              fontFamily: '"Syne", "Fraunces", sans-serif',
              fontWeight: 800,
              letterSpacing: "-0.04em",
              fontSize: { xs: "2rem", md: "2.75rem" },
              lineHeight: 1.05,
              mb: 1,
            }}
          >
            {t("brand")}
          </Typography>
          <Typography sx={{ maxWidth: 540, opacity: 0.82, fontSize: "1.05rem" }}>
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
            size="small"
            label={t("project")}
            value={activeId}
            onChange={(e) => setSelectedId(e.target.value)}
            sx={{
              minWidth: 240,
              flex: 1,
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgba(255,255,255,0.04)",
                color: "#DCDDE1",
              },
              "& .MuiInputLabel-root": { color: "rgba(232,234,238,0.7)" },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(232,234,238,0.2)",
              },
            }}
          >
            {(projects.data?.items ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
                {p.workspaceRoot ? "" : " · —"}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={!activeId || cycle.isPending}
            onClick={() => cycle.mutate()}
            sx={{
              bgcolor: "#9A9EA8",
              color: "#12141A",
              fontWeight: 800,
              px: 2.5,
              "&:hover": { bgcolor: "#ADB1BA" },
            }}
          >
            {cycle.isPending ? t("running") : t("run")}
          </Button>
          <Button
            variant="outlined"
            disabled={!activeId || promote.isPending}
            onClick={() => promote.mutate()}
            sx={{ borderColor: "rgba(232,234,238,0.35)", color: "#DCDDE1" }}
          >
            {t("promoteExpected")}
          </Button>
          <Button
            component={Link}
            href="/observer"
            variant="text"
            sx={{ color: "#9A9EA8", fontWeight: 650 }}
          >
            {t("openObserver")}
          </Button>
        </Stack>

        {activeId ? (
          <LinkWorkspaceRoot
            projectId={activeId}
            currentRoot={activeProject?.workspaceRoot}
            compact
          />
        ) : null}

        {cycle.isError ? (
          <Alert severity="error">
            {cycle.error instanceof Error ? cycle.error.message : t("error")}
          </Alert>
        ) : null}
        {promote.isError ? (
          <Alert severity="error">
            {promote.error instanceof Error ? promote.error.message : t("error")}
          </Alert>
        ) : null}
        {proposeFix.isError ? (
          <Alert severity="error">
            {proposeFix.error instanceof Error
              ? proposeFix.error.message
              : t("proposeError")}
          </Alert>
        ) : null}
        {proposeFix.isSuccess ? (
          <Alert severity="success">
            {proposeFix.data.note}{" "}
            <Button component={Link} href="/patches" size="small" sx={{ ml: 1 }}>
              {t("openPatches")}
            </Button>
          </Alert>
        ) : null}
        {linkError ? (
          <Alert severity="warning">
            {linkError}{" "}
            <Button component={Link} href="/projects" size="small" sx={{ ml: 1 }}>
              {t("openProjects")}
            </Button>
          </Alert>
        ) : null}

        {expectedCompare && !linkError ? (
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid rgba(154,158,168,0.25)",
              bgcolor: "rgba(0,0,0,0.2)",
            }}
          >
            <Typography
              sx={{
                fontFamily: '"Syne", sans-serif',
                fontWeight: 750,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontSize: 12,
                opacity: 0.75,
                mb: 1,
              }}
            >
              {t("expectedTitle")}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85, mb: 1 }}>
              {t("expectedMeta", {
                expected: expectedCompare.expectedFlowCount,
                observed: expectedCompare.observedFlowCount,
                drifts: expectedCompare.driftCount,
                source: expectedCompare.source ?? "—",
              })}
            </Typography>
            {expectedCompare.drifts.slice(0, 3).map((d) => (
              <Box key={d.title} sx={{ mb: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={d.riskBand} />
                  <Typography fontWeight={650}>{d.title}</Typography>
                </Stack>
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block" }}>
                  EXPECTED: {d.beforeSteps.join(" → ") || "—"}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block" }}>
                  OBSERVED: {d.afterSteps.join(" → ") || "—"}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : null}

        {p1Signals && !linkError ? (
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid rgba(232,234,238,0.14)",
              bgcolor: "rgba(0,0,0,0.18)",
            }}
          >
            <Typography
              sx={{
                fontFamily: '"Syne", sans-serif',
                fontWeight: 750,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontSize: 12,
                opacity: 0.75,
                mb: 1,
              }}
            >
              {t("p1Title")}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Chip
                size="small"
                label={t("p1Auth", { n: p1Signals.authEdges })}
                sx={{ bgcolor: "rgba(154,158,168,0.12)", color: "#B4B7BE" }}
              />
              <Chip
                size="small"
                label={t("p1Identity", { n: p1Signals.identityNodes ?? 0 })}
                sx={{ bgcolor: "rgba(154,158,168,0.12)", color: "#B4B7BE" }}
              />
              <Chip
                size="small"
                label={t("p1Sensitive", { n: p1Signals.sensitiveEdges })}
                sx={{ bgcolor: "rgba(224,122,95,0.15)", color: "#F2C4B8" }}
              />
              <Chip
                size="small"
                label={t("p1Sentinel", {
                  posture: p1Signals.sentinelPosture ?? "—",
                  critical: p1Signals.sentinelCritical ?? 0,
                  high: p1Signals.sentinelHigh ?? 0,
                })}
                sx={{ bgcolor: "rgba(224,122,95,0.18)", color: "#F2C4B8" }}
                component={Link}
                href="/sentinel"
                clickable
              />
              <Chip
                size="small"
                label={t("p1Isolation", {
                  denied: p1Signals.isolationDenied ?? 0,
                  bound: p1Signals.isolationBound ?? 0,
                })}
                sx={{ bgcolor: "rgba(154,158,168,0.12)", color: "#B4B7BE" }}
              />
              <Chip
                size="small"
                label={t("p1Packages", {
                  n: p1Signals.packageNodes ?? 0,
                  adv: p1Signals.advisoryIncidents ?? 0,
                })}
                sx={{ bgcolor: "rgba(154,158,168,0.12)", color: "#B4B7BE" }}
              />
              <Chip
                size="small"
                label={t("p1Data", { n: p1Signals.dataStoreNodes ?? 0 })}
                sx={{ bgcolor: "rgba(224,122,95,0.15)", color: "#F2C4B8" }}
              />
              <Chip
                size="small"
                label={t("p1Adr", { n: p1Signals.adrConflicts })}
                sx={{ bgcolor: "rgba(224,177,90,0.15)", color: "#F0D7A0" }}
              />
              <Chip
                size="small"
                label={t("p1Decided", { n: p1Signals.decidedByEdges ?? 0 })}
                sx={{ bgcolor: "rgba(224,177,90,0.15)", color: "#F0D7A0" }}
              />
              <Chip
                size="small"
                label={t("p1Decisions", { n: p1Signals.decisionNodes })}
                sx={{ bgcolor: "rgba(255,255,255,0.06)", color: "#DCDDE1" }}
              />
              <Chip
                size="small"
                label={t("p1DeployNodes", { n: p1Signals.deploymentNodes ?? 0 })}
                sx={{ bgcolor: "rgba(154,158,168,0.12)", color: "#B4B7BE" }}
              />
              <Chip
                size="small"
                label={t("p1Prod", {
                  present: p1Signals.productionPresent,
                  missing: p1Signals.productionMissing,
                })}
                sx={{ bgcolor: "rgba(255,255,255,0.06)", color: "#DCDDE1" }}
              />
            </Stack>
            {p1Signals.lastDeploy ? (
              <Typography variant="caption" sx={{ opacity: 0.75, display: "block", mb: 0.5 }}>
                {t("p1LastDeploy", {
                  provider: p1Signals.lastDeploy.provider,
                  env: p1Signals.lastDeploy.environment,
                  status: p1Signals.lastDeploy.status,
                })}
              </Typography>
            ) : null}
            {p1Signals.missingTitles.length > 0 ? (
              <Typography variant="caption" sx={{ opacity: 0.7, display: "block" }}>
                {t("p1Missing", { list: p1Signals.missingTitles.slice(0, 4).join(", ") })}
              </Typography>
            ) : null}
            <Typography variant="caption" sx={{ opacity: 0.65, display: "block", mt: 0.75 }}>
              {t("isolationNote")}
            </Typography>
          </Box>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
            gap: 2.5,
          }}
        >
          <Box
            sx={{
              p: 2.5,
              borderRadius: 2,
              background:
                "linear-gradient(160deg, rgba(18,21,28,0.92), rgba(14,17,22,0.75))",
              border: "1px solid rgba(154,158,168,0.22)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            }}
          >
            <Typography
              sx={{
                fontFamily: '"Syne", sans-serif',
                fontWeight: 750,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontSize: 12,
                opacity: 0.7,
                mb: 2,
              }}
            >
              {t("healthTitle")}
            </Typography>
            <Stack spacing={1.75}>
              <ScoreRail label={t("software")} value={scores.software} delayMs={40} />
              <ScoreRail label={t("behavior")} value={scores.behavior} delayMs={120} />
              <ScoreRail label={t("security")} value={scores.security} delayMs={200} />
              <ScoreRail
                label={t("architecture")}
                value={scores.architecture}
                delayMs={280}
              />
              <ScoreRail label={t("tests")} value={scores.tests} delayMs={360} />
            </Stack>
            <Typography variant="caption" sx={{ display: "block", mt: 2, opacity: 0.65 }}>
              {graph.data
                ? t("graphMeta", {
                    nodes: graph.data.total,
                    edges: graph.data.edgesTotal,
                  })
                : t("graphEmpty")}
            </Typography>
          </Box>

          <Stack spacing={2}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1.25,
              }}
            >
              {[
                { label: t("critical"), value: critical, tone: "#E07A5F" },
                { label: t("drifts"), value: drifts, tone: "#E0B15A" },
                { label: t("analyzed"), value: analyzed, tone: "#9A9EA8" },
                { label: t("verified"), value: verified, tone: "#B4B7BE" },
              ].map((cell, i) => (
                <Box
                  key={cell.label}
                  sx={{
                    p: 1.75,
                    borderRadius: 2,
                    bgcolor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    animation: `truthRise 650ms ${80 + i * 70}ms both`,
                    "@keyframes truthRise": {
                      from: { opacity: 0, transform: "translateY(8px)" },
                      to: { opacity: 1, transform: "none" },
                    },
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {cell.label}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: '"Syne", sans-serif',
                      fontWeight: 800,
                      fontSize: "1.75rem",
                      color: cell.tone,
                      lineHeight: 1.1,
                    }}
                  >
                    {cell.value}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Box
              sx={{
                p: 2.25,
                borderRadius: 2,
                background:
                  "linear-gradient(145deg, rgba(154,158,168,0.14), rgba(14,17,22,0.5))",
                border: "1px solid rgba(154,158,168,0.28)",
                minHeight: 180,
              }}
            >
              <Typography
                sx={{
                  fontFamily: '"Syne", sans-serif',
                  fontWeight: 750,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontSize: 12,
                  opacity: 0.75,
                  mb: 1.25,
                }}
              >
                {t("mostImportant")}
              </Typography>
              {topFinding ? (
                <Stack spacing={1.25}>
                  <Typography fontWeight={750} sx={{ fontSize: "1.15rem" }}>
                    {topFinding.title}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {topFinding.detail}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={topFinding.riskBand}
                      sx={{ bgcolor: "rgba(224,122,95,0.2)", color: "#F2C4B8" }}
                    />
                    <Chip
                      size="small"
                      label={topFinding.claim}
                      sx={{ bgcolor: "rgba(154,158,168,0.15)", color: "#B4B7BE" }}
                    />
                    <Chip
                      size="small"
                      label={topFinding.epistemicState}
                      variant="outlined"
                      sx={{ borderColor: "rgba(232,234,238,0.25)", color: "#DCDDE1" }}
                    />
                  </Stack>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t("evidenceHint")}
                  </Typography>
                  {(topFinding.evidenceRefs?.length ?? 0) > 0 ? (
                    <Box
                      component="ul"
                      sx={{ m: 0, pl: 2, opacity: 0.8, fontSize: "0.8rem" }}
                    >
                      {topFinding.evidenceRefs!.slice(0, 6).map((ref) => (
                        <li key={ref}>{ref}</li>
                      ))}
                    </Box>
                  ) : null}
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      component={Link}
                      href="/observer"
                      size="small"
                      variant="contained"
                      sx={{ bgcolor: "#DCDDE1", color: "#12141A", fontWeight: 700 }}
                    >
                      {t("investigate")}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!activeId || proposeFix.isPending}
                      onClick={() => proposeFix.mutate(topFinding)}
                      sx={{ borderColor: "rgba(232,234,238,0.35)", color: "#DCDDE1" }}
                    >
                      {proposeFix.isPending ? t("proposing") : t("proposeFix")}
                    </Button>
                    <Button
                      component={Link}
                      href="/patches"
                      size="small"
                      variant="text"
                      sx={{ color: "#9A9EA8" }}
                    >
                      {t("openPatches")}
                    </Button>
                    <Button
                      component={Link}
                      href="/readiness"
                      size="small"
                      variant="text"
                      sx={{ color: "#9A9EA8" }}
                    >
                      {t("verify")}
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Typography sx={{ opacity: 0.7 }}>{t("emptyFinding")}</Typography>
              )}
            </Box>
          </Stack>
        </Box>

        {result?.risk.summary ? (
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            {result.risk.summary}
            {result.previousGenomeAt
              ? ` · ${t("compared", { at: result.previousGenomeAt })}`
              : ` · ${t("baseline")}`}
          </Typography>
        ) : null}

        {history.length > 0 ? (
          <Box sx={{ pt: 1 }}>
            <Typography
              sx={{
                fontFamily: '"Syne", sans-serif',
                fontWeight: 750,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontSize: 12,
                opacity: 0.7,
                mb: 1.25,
              }}
            >
              {t("history")}
            </Typography>
            <Stack spacing={1}>
              {history.slice(0, 8).map((h) => (
                <Stack
                  key={h.id}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ sm: "center" }}
                  sx={{
                    py: 1,
                    borderBottom: "1px solid rgba(232,234,238,0.1)",
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.65, minWidth: 160 }}>
                    {h.at}
                  </Typography>
                  <Chip
                    size="small"
                    label={h.riskBand}
                    sx={{ bgcolor: "rgba(255,255,255,0.06)", color: "#DCDDE1" }}
                  />
                  <Chip
                    size="small"
                    label={h.trigger}
                    variant="outlined"
                    sx={{ borderColor: "rgba(232,234,238,0.2)", color: "#DCDDE1" }}
                  />
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {h.topFindingTitle ?? t("historyEmptyTitle")}
                    {h.behaviorDiffCount
                      ? ` · ${h.behaviorDiffCount} drifts`
                      : ""}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ) : null}

        {snapshots.length > 0 ? (
          <Box sx={{ pt: 1 }}>
            <Typography
              sx={{
                fontFamily: '"Syne", sans-serif',
                fontWeight: 750,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontSize: 12,
                opacity: 0.7,
                mb: 1.25,
              }}
            >
              {t("snapshots")}
            </Typography>
            <Stack spacing={0.75}>
              {snapshots.slice(0, 8).map((s) => (
                <Typography key={s.file} variant="body2" sx={{ opacity: 0.8 }}>
                  {s.capturedAt} · {s.apiCount} flows · {s.file}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
