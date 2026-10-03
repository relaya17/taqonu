"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface EvalTask {
  id: string;
  category: string;
  title: string;
  riskLevel: string;
  goldenProject?: boolean;
}

interface EvalResult {
  id: string;
  taskId: string;
  status: string;
  score: number;
  notes: string;
  evidenceCount: number;
  unauthorizedWrite: boolean;
}

interface SuiteRun {
  id: string;
  atlasVersion: string;
  startedAt: string;
  completedAt: string | null;
  results: EvalResult[];
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  unauthorizedWrites: number;
  projectId: string | null;
}

interface ProofMetrics {
  truth: number;
  engineeringSuccess: number;
  qaAccuracy: number;
  autonomy: number;
}

interface RegressionReport {
  id: string;
  previousPassRate: number;
  currentPassRate: number;
  delta: number;
  status: string;
  regressions: { taskId: string; previous: string; current: string }[];
  plainLanguageSummary: string;
}

interface ProofReport {
  id: string;
  status: string;
  golden: { slug: string; workspaceRoot: string; source: string; exists: boolean };
  suite: SuiteRun;
  gates: {
    id: string;
    taskId: string;
    title: string;
    status: string;
    notes: string;
    evidenceCount: number;
    unauthorizedWrite: boolean;
  }[];
  checklist: {
    workspaceExists: boolean;
    allGatesPass: boolean;
    unauthorizedWritesZero: boolean;
    suitePassRateOk: boolean;
  };
  metrics: ProofMetrics;
  plainLanguageSummary: string;
  createdAt: string;
}

interface ProofStatus {
  hasRun: boolean;
  golden: { slug: string; workspaceRoot: string; exists: boolean; source: string };
  report: ProofReport | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function statusColor(s: string): "success" | "error" | "warning" | "default" {
  if (s === "PASS" || s === "IMPROVED") return "success";
  if (s === "FAIL" || s === "ERROR" || s === "BLOCKED") return "error";
  if (s === "PARTIAL") return "warning";
  return "default";
}

/** Benchmarks (eval tasks/suites/regression) + Atlas Proof golden run. */
export function BenchmarksPanel({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("benchmarksPanel");
  const queryClient = useQueryClient();
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [previousId, setPreviousId] = useState("");
  const [currentId, setCurrentId] = useState("");

  const tasks = useQuery({
    queryKey: ["benchmark-tasks"],
    queryFn: () =>
      apiGet<{ items: EvalTask[]; total: number }>("/api/v1/benchmarks/tasks"),
    staleTime: 5 * 60_000,
  });

  const suites = useQuery({
    queryKey: ["benchmark-suites"],
    queryFn: () => apiGet<{ items: SuiteRun[] }>("/api/v1/benchmarks/suites"),
    retry: false,
  });

  const proof = useQuery({
    queryKey: ["proof-status", projectId],
    enabled: Boolean(projectId),
    retry: false,
    queryFn: () =>
      apiGet<ProofStatus>(
        `/api/v1/proof/status?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const runSuite = useMutation({
    mutationFn: () =>
      apiPost<{ suite: SuiteRun; metrics: ProofMetrics }>("/api/v1/benchmarks/run", {
        projectId,
        ...(selectedTasks.length > 0 ? { taskIds: selectedTasks } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["benchmark-suites"] });
    },
  });

  const regression = useMutation({
    mutationFn: () =>
      apiPost<RegressionReport>("/api/v1/benchmarks/regression", {
        previousSuiteId: previousId,
        currentSuiteId: currentId,
      }),
  });

  const runProof = useMutation({
    mutationFn: () => apiPost<ProofReport>("/api/v1/proof/run", { projectId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["proof-status", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["benchmark-suites"] });
    },
  });

  const projectSuites = useMemo(
    () =>
      [...(suites.data?.items ?? [])]
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [suites.data, projectId],
  );

  const toggleTask = (id: string) =>
    setSelectedTasks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const proofReport = runProof.data ?? proof.data?.report ?? null;
  const lastRun = runSuite.data;

  const suiteLabel = (s: SuiteRun) =>
    `${s.startedAt} · ${pct(s.passRate)} · ${s.id.slice(0, 8)}`;

  const metricRow = (m: ProofMetrics) => (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip size="small" variant="outlined" label={t("metricTruth", { value: pct(m.truth) })} />
      <Chip size="small" variant="outlined" label={t("metricEngineering", { value: pct(m.engineeringSuccess) })} />
      <Chip size="small" variant="outlined" label={t("metricQa", { value: pct(m.qaAccuracy) })} />
      <Chip size="small" variant="outlined" label={t("metricAutonomy", { value: pct(m.autonomy) })} />
    </Stack>
  );

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920, width: "100%" }}>
      <Box>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.4rem", sm: "1.6rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {!projectId ? <Alert severity="info">{t("noProject")}</Alert> : null}

      {/* Suite run */}
      <Box>
        <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
          {t("suiteTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("goldenNote")}
        </Typography>
        <Button
          variant="text"
          onClick={() => setTasksOpen((v) => !v)}
          aria-expanded={tasksOpen}
          aria-controls="benchmark-task-list"
          sx={{ mt: 1 }}
        >
          {tasksOpen
            ? t("hideTasks")
            : t("showTasks", { count: tasks.data?.items.length ?? 0 })}
        </Button>
        {tasks.isError ? (
          <Alert severity="warning">{(tasks.error as Error).message}</Alert>
        ) : null}
        {tasksOpen ? (
          <Stack id="benchmark-task-list" spacing={0.25} sx={{ mt: 0.5 }}>
            {(tasks.data?.items ?? []).length === 0 ? (
              <Typography color="text.secondary">{t("noTasks")}</Typography>
            ) : (
              (tasks.data?.items ?? []).map((task) => (
                <FormControlLabel
                  key={task.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedTasks.includes(task.id)}
                      onChange={() => toggleTask(task.id)}
                    />
                  }
                  label={`${task.title} · ${task.category} · ${task.riskLevel}`}
                />
              ))
            )}
          </Stack>
        ) : null}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {selectedTasks.length > 0
            ? t("selectedTasks", { count: selectedTasks.length })
            : t("allTasks")}
        </Typography>
        <Button
          variant="contained"
          sx={{ mt: 1 }}
          disabled={!projectId || runSuite.isPending}
          onClick={() => runSuite.mutate()}
        >
          {runSuite.isPending ? t("running") : t("runSuite")}
        </Button>
        {runSuite.isError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {(runSuite.error as Error).message}
          </Alert>
        ) : null}
        {lastRun ? (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={t("passRate", { value: pct(lastRun.suite.passRate) })} />
              <Chip size="small" color="success" label={t("passedCount", { count: lastRun.suite.passed })} />
              <Chip size="small" color="error" label={t("failedCount", { count: lastRun.suite.failed })} />
              <Chip size="small" variant="outlined" label={t("skippedCount", { count: lastRun.suite.skipped })} />
              <Chip
                size="small"
                color={lastRun.suite.unauthorizedWrites > 0 ? "error" : "default"}
                label={t("unauthorizedWrites", { count: lastRun.suite.unauthorizedWrites })}
              />
            </Stack>
            <Box sx={{ mt: 1 }}>{metricRow(lastRun.metrics)}</Box>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {lastRun.suite.results.map((r) => (
                <Stack key={r.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" color={statusColor(r.status)} label={r.status} />
                  <Typography variant="body2" fontWeight={600}>
                    {r.taskId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r.notes}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Box>

      {/* Regression */}
      <Box>
        <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
          {t("regressionTitle")}
        </Typography>
        {suites.isError ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            {(suites.error as Error).message}
          </Alert>
        ) : projectSuites.length < 2 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("regressionNeedTwo", { count: projectSuites.length })}
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                select
                size="small"
                label={t("previousSuite")}
                value={previousId}
                onChange={(e) => setPreviousId(e.target.value)}
                sx={{ minWidth: 260 }}
              >
                {projectSuites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {suiteLabel(s)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label={t("currentSuite")}
                value={currentId}
                onChange={(e) => setCurrentId(e.target.value)}
                sx={{ minWidth: 260 }}
              >
                {projectSuites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {suiteLabel(s)}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Button
              variant="outlined"
              sx={{ alignSelf: "flex-start" }}
              disabled={
                !previousId || !currentId || previousId === currentId || regression.isPending
              }
              onClick={() => regression.mutate()}
            >
              {t("compare")}
            </Button>
            {regression.isError ? (
              <Alert severity="error">{(regression.error as Error).message}</Alert>
            ) : null}
            {regression.data ? (
              <Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" color={statusColor(regression.data.status)} label={regression.data.status} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("passRateChange", {
                      from: pct(regression.data.previousPassRate),
                      to: pct(regression.data.currentPassRate),
                    })}
                  />
                </Stack>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {regression.data.plainLanguageSummary}
                </Typography>
                {regression.data.regressions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t("noRegressions")}
                  </Typography>
                ) : (
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {regression.data.regressions.map((r) => (
                      <Typography key={r.taskId} variant="body2">
                        {r.taskId}: {r.previous} → {r.current}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            ) : null}
          </Stack>
        )}
      </Box>

      {/* Proof */}
      {projectId ? (
        <Box>
          <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
            {t("proofTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("proofHelp")}
          </Typography>
          {proof.data ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, wordBreak: "break-all" }}>
              {t("golden", {
                slug: proof.data.golden.slug,
                source: proof.data.golden.source,
              })}
              {proof.data.golden.exists ? "" : ` · ${t("goldenMissing")}`}
            </Typography>
          ) : null}
          <Button
            variant="contained"
            sx={{ mt: 1 }}
            disabled={runProof.isPending}
            onClick={() => runProof.mutate()}
          >
            {runProof.isPending ? t("running") : t("runProof")}
          </Button>
          {proof.isError ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              {(proof.error as Error).message}
            </Alert>
          ) : null}
          {runProof.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(runProof.error as Error).message}
            </Alert>
          ) : null}
          {proofReport ? (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Chip color={statusColor(proofReport.status)} label={proofReport.status} />
                <Typography variant="caption" color="text.secondary">
                  {proofReport.createdAt}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {proofReport.plainLanguageSummary}
              </Typography>
              <Box sx={{ mt: 1 }}>{metricRow(proofReport.metrics)}</Box>
              <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                {proofReport.gates.map((g) => (
                  <Box key={g.id}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" variant="outlined" label={g.id} />
                      <Chip size="small" color={statusColor(g.status)} label={g.status} />
                      <Typography variant="body2" fontWeight={600}>
                        {g.title}
                      </Typography>
                    </Stack>
                    {g.notes ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {g.notes}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Stack>
              <Stack spacing={0.25} sx={{ mt: 1.5 }}>
                {(
                  [
                    ["workspaceExists", proofReport.checklist.workspaceExists],
                    ["allGatesPass", proofReport.checklist.allGatesPass],
                    ["unauthorizedWritesZero", proofReport.checklist.unauthorizedWritesZero],
                    ["suitePassRateOk", proofReport.checklist.suitePassRateOk],
                  ] as const
                ).map(([key, ok]) => (
                  <Typography key={key} variant="body2">
                    {ok ? t("yes") : t("no")} — {t(`check.${key}`)}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : proof.data && !proof.data.hasRun ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("proofEmpty")}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
