"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface LoopStage {
  stage: string;
  status: string;
  summary: string;
}

interface LoopRun {
  id: string;
  status: string;
  actionKind: string;
  mode: string;
  risk: string | null;
  patchId: string | null;
  plainLanguageSummary: string;
  stages: LoopStage[];
  workspaceRoot: string;
}

interface SuitePayload {
  suite: {
    id: string;
    passRate: number;
    passed: number;
    failed: number;
    unauthorizedWrites: number;
    results: Array<{
      taskId: string;
      status: string;
      notes: string;
      evidenceCount: number;
      unauthorizedWrite: boolean;
    }>;
  };
  metrics: {
    truth: number;
    engineeringSuccess: number;
    qaAccuracy: number;
    autonomy: number;
  };
}

interface ProofReport {
  id: string;
  status: "PASS" | "FAIL" | "PARTIAL";
  plainLanguageSummary: string;
  evidenceReportMarkdown: string;
  golden: {
    slug: string;
    workspaceRoot: string;
    source: string;
    exists: boolean;
  };
  gates: Array<{
    id: string;
    taskId: string;
    title: string;
    status: string;
    evidenceCount: number;
  }>;
  checklist: {
    workspaceExists: boolean;
    allGatesPass: boolean;
    unauthorizedWritesZero: boolean;
    suitePassRateOk: boolean;
  };
  metrics: {
    truth: number;
    engineeringSuccess: number;
    qaAccuracy: number;
    autonomy: number;
  };
  suite: {
    passRate: number;
    passed: number;
    failed: number;
    unauthorizedWrites: number;
  };
  verdictSummary: {
    status: string | null;
    productionReadiness: number | null;
  } | null;
}

interface ProofStatus {
  hasRun: boolean;
  golden: {
    slug: string;
    workspaceRoot: string;
    exists: boolean;
    source: string;
  };
  report: ProofReport | null;
  howToRun: string[];
}

export default function ProofPage() {
  const t = useTranslations("proof");
  const queryClient = useQueryClient();
  const [request, setRequest] = useState(
    "Analyze the impact of changing the client duplicate-detection algorithm.",
  );

  const golden = useQuery({
    queryKey: ["golden-project"],
    queryFn: () =>
      apiGet<{
        slug: string;
        workspaceRoot: string;
        exists: boolean;
        source?: string;
        note?: string;
      }>("/api/v1/golden/project"),
  });

  const proofStatus = useQuery({
    queryKey: ["proof-status"],
    queryFn: () => apiGet<ProofStatus>("/api/v1/proof/status"),
  });

  const tasks = useQuery({
    queryKey: ["benchmark-tasks"],
    queryFn: () =>
      apiGet<{ items: Array<{ id: string; title: string; task: string }> }>(
        "/api/v1/benchmarks/tasks",
      ),
  });

  const loop = useMutation({
    mutationFn: () =>
      apiPost<LoopRun>("/api/v1/engineering/loop", {
        userRequest: request,
        projectSlug: "brokeros",
        workspaceRoot: golden.data?.workspaceRoot,
      }),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiPost<LoopRun>(`/api/v1/engineering/loop/${id}/approve`, {
        approvedBy: "human",
        apply: true,
        note: "UI approval",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  const bench = useMutation({
    mutationFn: () =>
      apiPost<SuitePayload>("/api/v1/benchmarks/run", {
        workspaceRoot: golden.data?.workspaceRoot,
        projectSlug: "brokeros",
      }),
  });

  const proof = useMutation({
    mutationFn: () =>
      apiPost<ProofReport>("/api/v1/proof/run", {
        workspaceRoot: golden.data?.workspaceRoot,
        projectSlug: "brokeros",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["proof-status"] });
    },
  });

  const run = loop.data ?? approve.data;
  const suite = bench.data;
  const proofReport = proof.data ?? proofStatus.data?.report ?? null;

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity={golden.data?.exists ? "success" : "warning"}>
        {t("golden", {
          slug: golden.data?.slug ?? "brokeros",
          path: golden.data?.workspaceRoot ?? "…",
          ok: golden.data?.exists ? "OK" : "MISSING",
        })}
        {golden.data?.source
          ? ` · source=${golden.data.source}`
          : null}
      </Alert>

      {proofStatus.data ? (
        <Alert severity={proofReport?.status === "PASS" ? "success" : "info"}>
          {proofStatus.data.hasRun
            ? t("lastStatus", {
                status: proofReport?.status ?? "…",
                summary: proofReport?.plainLanguageSummary ?? "",
              })
            : t("neverRun")}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {(proofStatus.data.howToRun ?? []).join(" · ")}
          </Typography>
        </Alert>
      ) : null}

      <TextField
        label={t("request")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        multiline
        minRows={3}
        fullWidth
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          color="secondary"
          disabled={proof.isPending}
          onClick={() => proof.mutate()}
        >
          {t("runProof")}
        </Button>
        <Button
          variant="contained"
          disabled={loop.isPending}
          onClick={() => loop.mutate()}
        >
          {t("runLoop")}
        </Button>
        <Button
          variant="outlined"
          disabled={bench.isPending}
          onClick={() => bench.mutate()}
        >
          {t("runBench")}
        </Button>
      </Stack>

      {(tasks.data?.items ?? []).length > 0 ? (
        <Box>
          <Typography fontWeight={700}>{t("tasks")}</Typography>
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {tasks.data!.items.map((task) => (
              <Typography
                key={task.id}
                variant="body2"
                sx={{ cursor: "pointer" }}
                onClick={() => setRequest(task.task)}
              >
                {task.id} — {task.title}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}

      {proofReport ? (
        <Box>
          <Typography fontWeight={700}>{t("proofResult")}</Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Chip
              label={proofReport.status}
              color={
                proofReport.status === "PASS"
                  ? "success"
                  : proofReport.status === "PARTIAL"
                    ? "warning"
                    : "error"
              }
            />
            <Chip
              label={`${Math.round(proofReport.suite.passRate * 100)}%`}
              variant="outlined"
            />
            <Chip
              label={`${t("unauthorized", { n: proofReport.suite.unauthorizedWrites })}`}
              variant="outlined"
            />
          </Stack>
          <Typography sx={{ mt: 1 }}>{proofReport.plainLanguageSummary}</Typography>
          {proofReport.verdictSummary?.status ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("verdictAttached", {
                status: proofReport.verdictSummary.status,
                score: proofReport.verdictSummary.productionReadiness ?? "—",
              })}
            </Typography>
          ) : null}
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {proofReport.gates.map((g) => (
              <Typography key={g.id} variant="body2">
                Gate {g.id}: {g.status} · {g.taskId} · evidence={g.evidenceCount}
              </Typography>
            ))}
          </Stack>
          <Typography
            component="pre"
            variant="body2"
            sx={{
              mt: 2,
              p: 1.5,
              bgcolor: "action.hover",
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
            }}
          >
            {proofReport.evidenceReportMarkdown}
          </Typography>
        </Box>
      ) : null}

      {run ? (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={run.status} color="info" />
            <Chip label={run.actionKind} variant="outlined" />
            <Chip label={run.mode} variant="outlined" />
            {run.risk ? <Chip label={run.risk} color="warning" /> : null}
          </Stack>
          <Typography sx={{ mt: 1 }}>{run.plainLanguageSummary}</Typography>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {run.stages.map((s) => (
              <Box
                key={s.stage}
                sx={{ py: 1, borderBottom: "1px solid rgba(20,32,34,0.12)" }}
              >
                <Stack direction="row" spacing={1}>
                  <Typography fontWeight={700}>{s.stage}</Typography>
                  <Chip size="small" label={s.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {s.summary}
                </Typography>
              </Box>
            ))}
          </Stack>
          {run.status === "AWAITING_APPROVAL" ? (
            <Button
              sx={{ mt: 2 }}
              variant="contained"
              disabled={approve.isPending}
              onClick={() => approve.mutate(run.id)}
            >
              {t("approve")}
            </Button>
          ) : null}
        </Box>
      ) : null}

      {suite ? (
        <Box>
          <Typography fontWeight={700}>{t("suiteResult")}</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("passRate", {
              n: Math.round(suite.suite.passRate * 100),
              passed: suite.suite.passed,
              failed: suite.suite.failed,
            })}
          </Typography>
          <Typography variant="body2">
            {t("metrics", {
              truth: Math.round(suite.metrics.truth * 100),
              eng: Math.round(suite.metrics.engineeringSuccess * 100),
              qa: Math.round(suite.metrics.qaAccuracy * 100),
              auto: Math.round(suite.metrics.autonomy * 100),
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("unauthorized", { n: suite.suite.unauthorizedWrites })}
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {suite.suite.results.map((r) => (
              <Typography key={r.taskId} variant="body2">
                {r.status} · {r.taskId} · evidence={r.evidenceCount}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}

      {loop.isError || bench.isError || proof.isError ? (
        <Alert severity="error">
          {((loop.error || bench.error || proof.error) as Error).message}
        </Alert>
      ) : null}
    </Stack>
  );
}
