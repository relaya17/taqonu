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
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";

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
    dependencies: number;
    config: number;
    packs?: number;
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
  const [actionNote, setActionNote] = useState<string | null>(null);

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
      setActionNote(null);
      void queryClient.invalidateQueries({
        queryKey: ["sentinel", selectedId],
      });
    },
  });

  const propose = useMutation({
    mutationFn: (findingId: string) =>
      apiPost<{ note: string; loop: string }>(
        `/api/v1/projects/${selectedId}/sentinel/propose`,
        { findingId },
      ),
    onSuccess: (data) => {
      setActionNote(`${data.loop} — ${data.note}`);
    },
  });

  const verify = useMutation({
    mutationFn: (findingId: string) =>
      apiPost<{ verified: boolean; note: string }>(
        `/api/v1/projects/${selectedId}/sentinel/verify`,
        { findingId },
      ),
    onSuccess: (data) => {
      setActionNote(data.note);
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

      {selectedId ? (
        <LinkWorkspaceRoot
          projectId={selectedId}
          currentRoot={
            (projects.data?.items ?? []).find((p) => p.id === selectedId)
              ?.workspaceRoot
          }
          compact
        />
      ) : null}

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

      {actionNote ? <Alert severity="info">{actionNote}</Alert> : null}

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
              label={t("countDeps", { n: result.counts.dependencies ?? 0 })}
            />
            <Chip
              size="small"
              label={t("countConfig", { n: result.counts.config ?? 0 })}
              variant="outlined"
            />
            <Chip
              size="small"
              label={t("countPacks", { n: result.counts.packs ?? 0 })}
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
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedId || propose.isPending}
                      onClick={() => propose.mutate(f.id)}
                    >
                      {t("propose")}
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      disabled={!selectedId || verify.isPending}
                      onClick={() => verify.mutate(f.id)}
                    >
                      {t("verify")}
                    </Button>
                  </Stack>
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
