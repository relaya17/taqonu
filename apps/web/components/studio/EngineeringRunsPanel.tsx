"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useStudioApi, type StudioExtensionScope } from "@/lib/studio-extension-api";
import { AUTH_SESSION_QUERY_KEY, fetchAuthSession } from "@/lib/auth-session";

interface LoopStage {
  stage: string;
  status: string;
  summary: string;
  epistemicState: string;
  durationMs: number;
  startedAt: string;
  completedAt: string | null;
}

interface LoopRun {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  userRequest: string;
  actionKind: string;
  mode: string;
  status: string;
  stages: LoopStage[];
  patchId: string | null;
  risk: string | null;
  plainLanguageSummary: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface ApproveResponse {
  status: string;
  message?: string;
  approvalRequestId?: string;
}

function statusColor(s: string): "success" | "error" | "warning" | "info" | "default" {
  if (s === "PASSED" || s === "APPLIED") return "success";
  if (s === "FAILED" || s === "BLOCKED") return "error";
  if (s === "AWAITING_APPROVAL") return "warning";
  if (s === "RUNNING") return "info";
  return "default";
}

function RunDetail({
  id,
  extensionScope,
}: {
  id: string;
  extensionScope: StudioExtensionScope | null;
}) {
  const t = useTranslations("engineeringRuns");
  const { apiGet } = useStudioApi(extensionScope);
  const detail = useQuery({
    queryKey: ["engineering-loop", id],
    queryFn: () => apiGet<LoopRun>(`/api/v1/engineering/loop/${encodeURIComponent(id)}`),
  });
  if (detail.isPending) return <LinearProgress aria-label={t("loading")} />;
  if (detail.isError) {
    return <Alert severity="error">{(detail.error as Error).message}</Alert>;
  }
  const run = detail.data;
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Typography variant="body2">{run.plainLanguageSummary}</Typography>
      <Typography variant="caption" color="text.secondary">
        {t("meta", { kind: run.actionKind, mode: run.mode })}
        {run.risk ? ` · ${t("risk", { risk: run.risk })}` : ""}
        {run.patchId ? ` · ${t("patch", { id: run.patchId.slice(0, 8) })}` : ""}
      </Typography>
      <Typography variant="subtitle2" component="h4">
        {t("stages")}
      </Typography>
      {run.stages.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("noStages")}
        </Typography>
      ) : (
        <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
          {run.stages.map((s) => (
            <Box component="li" key={s.stage}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={600}>
                  {s.stage}
                </Typography>
                <Chip size="small" color={statusColor(s.status)} label={s.status} />
                <Typography variant="caption" color="text.secondary">
                  {t("duration", { ms: s.durationMs })}
                </Typography>
              </Stack>
              {s.summary ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  {s.summary}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Engineering Loop runs for the current project, with approve for AWAITING_APPROVAL. */
export function EngineeringRunsPanel({
  projectId,
  embedded = false,
  extensionScope = null,
}: {
  projectId: string;
  embedded?: boolean;
  /** Set when the Engineering runs extension renders this panel (ADR-026). */
  extensionScope?: StudioExtensionScope | null;
}) {
  const t = useTranslations("engineeringRuns");
  const { apiGet, apiPost } = useStudioApi(extensionScope);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<{ severity: "success" | "info"; text: string } | null>(null);

  const session = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => fetchAuthSession<{ id: string; email: string }>(),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!approvedBy && session.data?.user.email) setApprovedBy(session.data.user.email);
  }, [session.data, approvedBy]);

  const list = useQuery({
    queryKey: ["engineering-loop-list"],
    enabled: Boolean(projectId),
    queryFn: () => apiGet<{ items: LoopRun[] }>("/api/v1/engineering/loop"),
  });

  const runs = useMemo(
    () =>
      (list.data?.items ?? [])
        .filter((r) => r.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [list.data, projectId],
  );

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiPost<ApproveResponse>(
        `/api/v1/engineering/loop/${encodeURIComponent(id)}/approve`,
        {
          approvedBy: approvedBy.trim(),
          apply: true,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      ),
    onSuccess: (data, id) => {
      setConfirmId(null);
      setNote("");
      if (data.status === "APPROVAL_REQUIRED") {
        setNotice({ severity: "info", text: data.message ?? t("secondIdentity") });
      } else {
        setNotice({ severity: "success", text: t("approved", { status: data.status }) });
      }
      void queryClient.invalidateQueries({ queryKey: ["engineering-loop-list"] });
      void queryClient.invalidateQueries({ queryKey: ["engineering-loop", id] });
    },
  });

  return (
    <Stack spacing={2.5} sx={{ maxWidth: embedded ? "100%" : 920, width: "100%" }}>
      <Box>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.4rem", sm: "1.6rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {!projectId ? (
        <Alert severity="info">{t("noProject")}</Alert>
      ) : list.isError ? (
        <Alert severity="error">{(list.error as Error).message}</Alert>
      ) : list.isPending ? (
        <LinearProgress aria-label={t("loading")} />
      ) : runs.length === 0 ? (
        <Typography color="text.secondary">{t("empty")}</Typography>
      ) : (
        <Stack spacing={1}>
          {notice ? (
            <Alert severity={notice.severity} onClose={() => setNotice(null)}>
              {notice.text}
            </Alert>
          ) : null}
          {runs.map((run) => {
            const open = expanded === run.id;
            return (
              <Box key={run.id} sx={{ py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" color={statusColor(run.status)} label={run.status} />
                  <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-word", flex: 1, minWidth: 160 }}>
                    {run.userRequest}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {run.createdAt}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setExpanded(open ? null : run.id)}
                    aria-expanded={open}
                    aria-controls={`loop-detail-${run.id}`}
                  >
                    {open ? t("hideDetail") : t("showDetail")}
                  </Button>
                  {run.status === "AWAITING_APPROVAL" ? (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        approve.reset();
                        setConfirmId(run.id);
                      }}
                    >
                      {t("approve")}
                    </Button>
                  ) : null}
                </Stack>
                {open ? (
                  <Box id={`loop-detail-${run.id}`}>
                    <RunDetail id={run.id} extensionScope={extensionScope} />
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      )}

      <Dialog open={Boolean(confirmId)} onClose={() => setConfirmId(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t("confirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("confirmBody")}</DialogContentText>
          <TextField
            label={t("approvedBy")}
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            fullWidth
            size="small"
            required
            sx={{ mt: 2 }}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            label={t("note")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
            sx={{ mt: 2 }}
            inputProps={{ maxLength: 2000 }}
          />
          {approve.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {(approve.error as Error).message}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmId(null)}>{t("cancel")}</Button>
          <Button
            variant="contained"
            disabled={!approvedBy.trim() || approve.isPending}
            onClick={() => confirmId && approve.mutate(confirmId)}
          >
            {approve.isPending ? t("approving") : t("confirmApprove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
