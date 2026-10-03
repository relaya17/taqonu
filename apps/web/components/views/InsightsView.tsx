"use client";

import { useMemo } from "react";
import {
  Alert,
  Box,
  Chip,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";

interface ProjectItem {
  id: string;
  name: string;
  updatedAt?: string;
}

interface TruthCounters {
  analyzed: number;
  meaningfulRisks: number;
  confirmedRegressions: number;
  caughtBeforeProd: number;
  cycles: number;
}

interface TruthBenchmark {
  asOf: string;
  items: {
    projectId: string;
    name: string;
    slug: string;
    linked: boolean;
    counters: TruthCounters | null;
  }[];
  totals: TruthCounters;
  linkedCount: number;
}

interface PortfolioPattern {
  id: string;
  kind: string;
  title: string;
  summary: string;
  projectIds: string[];
}

type AnomalyResult =
  | {
      status: "INSUFFICIENT_DATA";
      method: string;
      sampleSize: number;
      minSampleSize: number;
      reason: string;
    }
  | {
      status: "ANOMALY";
      method: string;
      index: number;
      point: { timestamp: string; value: number };
      score: number;
      threshold: number;
      severity: "LOW" | "MEDIUM" | "HIGH";
      sampleSize: number;
      minSampleSize: number;
      reason: string;
    };

interface AnomaliesResponse {
  method: string;
  generatedAt: string;
  byProject: {
    projectId: string;
    sampleSize: number;
    anomalies: AnomalyResult[];
  }[];
}

const MAX_ANOMALY_PROJECTS = 10;

const COUNTER_KEYS = [
  "analyzed",
  "meaningfulRisks",
  "confirmedRegressions",
  "caughtBeforeProd",
  "cycles",
] as const;

export function InsightsView() {
  const t = useTranslations("insightsView");
  const locale = useLocale();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const benchmark = useQuery({
    queryKey: ["portfolio-truth-benchmark"],
    queryFn: () => apiGet<TruthBenchmark>("/api/v1/portfolio/truth-benchmark"),
    staleTime: 60_000,
    retry: false,
  });

  const patterns = useQuery({
    queryKey: ["portfolio-patterns"],
    queryFn: () =>
      apiGet<{ items: PortfolioPattern[]; total: number }>(
        "/api/v1/portfolio/patterns",
      ),
    staleTime: 60_000,
    retry: false,
  });

  const projectItems = useMemo(() => projects.data?.items ?? [], [projects.data]);
  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectItems) map.set(p.id, p.name);
    return map;
  }, [projectItems]);

  const anomalyProjects = projectItems.slice(0, MAX_ANOMALY_PROJECTS);
  const anomalies = useQueries({
    queries: anomalyProjects.map((p) => ({
      queryKey: ["cost-anomalies", p.id],
      queryFn: () =>
        apiGet<AnomaliesResponse>(
          `/api/v1/cost-intelligence/anomalies?projectId=${encodeURIComponent(p.id)}`,
        ),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  const nf = new Intl.NumberFormat(locale);
  const usd = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });

  const severityLabel = (s: "LOW" | "MEDIUM" | "HIGH") =>
    s === "HIGH" ? t("severityHigh") : s === "MEDIUM" ? t("severityMedium") : t("severityLow");

  return (
    <Stack spacing={4} sx={{ maxWidth: 960, width: "100%" }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {/* Truth benchmark */}
      <Box component="section" aria-labelledby="insights-truth">
        <Typography id="insights-truth" variant="h2" sx={{ fontSize: "1.35rem" }}>
          {t("truthTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          {t("truthHelp")}
        </Typography>
        {benchmark.isLoading ? (
          <Skeleton variant="rounded" height={120} />
        ) : benchmark.isError ? (
          <Alert severity="info">
            {t("unavailable", { message: (benchmark.error as Error).message })}
          </Alert>
        ) : !benchmark.data || benchmark.data.items.length === 0 ? (
          <Alert severity="info">{t("truthEmpty")}</Alert>
        ) : (
          <>
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby="insights-truth">
                <TableHead>
                  <TableRow>
                    <TableCell component="th" scope="col">
                      {t("colProject")}
                    </TableCell>
                    {COUNTER_KEYS.map((k) => (
                      <TableCell key={k} component="th" scope="col" align="right">
                        {t(`counter.${k}`)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {benchmark.data.items.map((row) => (
                    <TableRow key={row.projectId}>
                      <TableCell component="th" scope="row">
                        {row.name}
                      </TableCell>
                      {row.linked && row.counters ? (
                        COUNTER_KEYS.map((k) => (
                          <TableCell key={k} align="right">
                            {nf.format(row.counters?.[k] ?? 0)}
                          </TableCell>
                        ))
                      ) : (
                        <TableCell colSpan={COUNTER_KEYS.length}>
                          <Typography variant="body2" color="text.secondary">
                            {t("noLinkedFolder")}
                          </Typography>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 700 }}>
                      {t("totals", { count: benchmark.data.linkedCount })}
                    </TableCell>
                    {COUNTER_KEYS.map((k) => (
                      <TableCell key={k} align="right" sx={{ fontWeight: 700 }}>
                        {nf.format(benchmark.data.totals[k])}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            {benchmark.data.linkedCount === 0 ? (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {t("truthNoneLinked")}
              </Alert>
            ) : null}
          </>
        )}
      </Box>

      {/* Shared patterns */}
      <Box component="section" aria-labelledby="insights-patterns">
        <Typography id="insights-patterns" variant="h2" sx={{ fontSize: "1.35rem" }}>
          {t("patternsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          {t("patternsHelp")}
        </Typography>
        {patterns.isLoading ? (
          <Skeleton variant="rounded" height={80} />
        ) : patterns.isError ? (
          <Alert severity="info">
            {t("unavailable", { message: (patterns.error as Error).message })}
          </Alert>
        ) : (patterns.data?.items ?? []).length === 0 ? (
          <Alert severity="info">{t("patternsEmpty")}</Alert>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {(patterns.data?.items ?? []).map((p) => (
              <Box
                component="li"
                key={p.id}
                sx={{ py: 1.25, borderBottom: "1px solid rgba(26,31,42,0.12)" }}
              >
                <Typography fontWeight={700}>{p.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {p.summary}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  {p.projectIds.map((id) => (
                    <Chip
                      key={id}
                      size="small"
                      variant="outlined"
                      label={projectNames.get(id) ?? t("unknownProject")}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Cost anomalies */}
      <Box component="section" aria-labelledby="insights-cost">
        <Typography id="insights-cost" variant="h2" sx={{ fontSize: "1.35rem" }}>
          {t("costTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          {t("costHelp")}
        </Typography>
        {projects.isLoading ? (
          <Skeleton variant="rounded" height={80} />
        ) : projects.isError ? (
          <Alert severity="info">
            {t("unavailable", { message: (projects.error as Error).message })}
          </Alert>
        ) : anomalyProjects.length === 0 ? (
          <Alert severity="info">{t("noProjects")}</Alert>
        ) : (
          <Stack spacing={1.5}>
            {projectItems.length > MAX_ANOMALY_PROJECTS ? (
              <Typography variant="body2" color="text.secondary">
                {t("costCapped", {
                  shown: MAX_ANOMALY_PROJECTS,
                  total: projectItems.length,
                })}
              </Typography>
            ) : null}
            {anomalyProjects.map((project, i) => {
              const q = anomalies[i];
              const row = q?.data?.byProject.find((b) => b.projectId === project.id);
              const insufficient = row?.anomalies.find(
                (a) => a.status === "INSUFFICIENT_DATA",
              );
              const flagged = (row?.anomalies ?? []).filter(
                (a): a is Extract<AnomalyResult, { status: "ANOMALY" }> =>
                  a.status === "ANOMALY",
              );
              return (
                <Box
                  key={project.id}
                  sx={{ py: 1.25, borderBottom: "1px solid rgba(26,31,42,0.12)" }}
                >
                  <Typography component="h3" fontWeight={700}>
                    {project.name}
                  </Typography>
                  {!q || q.isLoading ? (
                    <Skeleton width={240} />
                  ) : q.isError ? (
                    <Typography variant="body2" color="text.secondary">
                      {t("unavailable", { message: (q.error as Error).message })}
                    </Typography>
                  ) : !row ? (
                    <Typography variant="body2" color="text.secondary">
                      {t("costNoData")}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        {t("sampleSize", { count: row.sampleSize })}
                        {" · "}
                        {insufficient
                          ? t("insufficient", {
                              have: insufficient.sampleSize,
                              need: insufficient.minSampleSize,
                            })
                          : t("anomalyCount", { count: flagged.length })}
                      </Typography>
                      {flagged.length > 0 ? (
                        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
                          {flagged.map((a) => (
                            <li key={`${a.index}-${a.point.timestamp}`}>
                              <Typography variant="body2" component="span">
                                {t("anomalyLine", {
                                  date: a.point.timestamp,
                                  amount: usd.format(a.point.value),
                                  score: a.score.toFixed(2),
                                  threshold: a.threshold,
                                })}
                              </Typography>{" "}
                              <Chip
                                size="small"
                                color={
                                  a.severity === "HIGH"
                                    ? "error"
                                    : a.severity === "MEDIUM"
                                      ? "warning"
                                      : "default"
                                }
                                label={severityLabel(a.severity)}
                              />
                            </li>
                          ))}
                        </Box>
                      ) : null}
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
