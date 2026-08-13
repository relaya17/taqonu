"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface SentinelFinding {
  id: string;
  title: string;
  detail: string;
  severity: string;
  path?: string;
  remediation?: string;
  claim?: string;
  epistemicState?: string;
  redacted?: string;
  evidenceRefs?: string[];
}

interface SentinelScan {
  scannedAt: string;
  workspaceRoot: string;
  posture: string;
  summary: string;
  findings: SentinelFinding[];
  counts: {
    secrets: number;
    authz: number;
    critical: number;
    high: number;
  };
  nextActions: string[];
  mode: string;
  agent: string;
}

function postureSeverity(
  posture: string,
): "success" | "info" | "warning" | "error" {
  if (posture === "CLEAR" || posture === "LOW") return "success";
  if (posture === "MEDIUM") return "warning";
  return "error";
}

export default function SentinelPage() {
  const t = useTranslations("sentinel");
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const state = useQuery({
    queryKey: ["sentinel", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () =>
      apiGet<SentinelScan>(`/api/v1/projects/${selectedId}/sentinel`),
  });

  const scan = useMutation({
    mutationFn: () =>
      apiPost<SentinelScan>(
        `/api/v1/projects/${selectedId}/sentinel/scan`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["sentinel", selectedId],
      });
    },
  });

  const result = scan.data ?? state.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h4" component="h1" fontWeight={700}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info">{t("defensiveOnly")}</Alert>

      <TextField
        select
        label={t("project")}
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        fullWidth
      >
        {(projects.data?.items ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.workspaceRoot ? "" : ` (${t("unlinked")})`}
          </MenuItem>
        ))}
      </TextField>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disabled={!selectedId || scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? t("running") : t("run")}
        </Button>
      </Stack>

      {scan.isError ? (
        <Alert severity="error">
          {scan.error instanceof Error ? scan.error.message : t("error")}
        </Alert>
      ) : null}

      {state.isError && !scan.data ? (
        <Alert severity="warning">
          {state.error instanceof Error ? state.error.message : t("error")}
        </Alert>
      ) : null}

      {result ? (
        <Stack spacing={2}>
          <Alert severity={postureSeverity(result.posture)}>
            {t("posture", { posture: result.posture })} — {result.summary}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {t("scannedAt", { at: result.scannedAt })} · {result.agent} ·{" "}
            {result.mode}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={t("countSecrets", { n: result.counts.secrets })}
            />
            <Chip
              size="small"
              label={t("countAuthz", { n: result.counts.authz })}
              variant="outlined"
            />
            <Chip
              size="small"
              color={result.counts.critical > 0 ? "error" : "default"}
              label={t("countCritical", { n: result.counts.critical })}
            />
            <Chip
              size="small"
              color={result.counts.high > 0 ? "warning" : "default"}
              label={t("countHigh", { n: result.counts.high })}
              variant="outlined"
            />
          </Stack>

          <Stack spacing={1.5}>
            {result.findings.length === 0 ? (
              <Typography color="text.secondary">{t("clear")}</Typography>
            ) : (
              result.findings.map((f) => (
                <Box
                  key={f.id}
                  sx={{
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    pb: 1.25,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography fontWeight={650}>{f.title}</Typography>
                    <Chip size="small" label={f.severity} color="warning" />
                    {f.claim ? (
                      <Chip size="small" label={f.claim} variant="outlined" />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {f.detail}
                  </Typography>
                  {f.path ? (
                    <Typography variant="caption" display="block">
                      {f.path}
                      {f.redacted ? ` · ${f.redacted}` : ""}
                    </Typography>
                  ) : null}
                  {f.remediation ? (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {t("remediation")}: {f.remediation}
                    </Typography>
                  ) : null}
                </Box>
              ))
            )}
          </Stack>

          {result.nextActions.length > 0 ? (
            <Box>
              <Typography variant="h6" component="h2" gutterBottom>
                {t("nextActions")}
              </Typography>
              <Stack spacing={0.5}>
                {result.nextActions.map((a) => (
                  <Typography key={a} variant="body2">
                    · {a}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
