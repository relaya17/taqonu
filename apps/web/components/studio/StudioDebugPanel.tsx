"use client";

import { useState } from "react";
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useStudioApi, type StudioExtensionScope } from "@/lib/studio-extension-api";

interface DebugTargetSpec {
  id: string;
  program: string;
  description: string;
  pathArg: "required";
}

interface DebugSessionSnapshot {
  sessionId: string;
  projectId: string;
  targetId: string;
  openerId: string;
  pid: number;
  status: string;
  createdAt: string;
  lastActivityAt: string;
}

/**
 * Debugger panel — Studio Evolution design (2026-10-04). Targets are
 * ArletOS-launched only (no arbitrary PID attach, no PTY-as-target). Policy
 * (P2/P3/ownership/duplicate) is fail-closed server-side — P2 has no source
 * of truth yet, so every real request here is expected to be denied with
 * `P2_INSUFFICIENT_EVIDENCE` until that Data Model decision is made
 * separately. This panel surfaces that honestly rather than hiding it.
 */
export function StudioDebugPanel({
  projectId,
  extensionScope = null,
}: {
  projectId: string;
  /** Set when the built-in Debugger extension renders this panel (ADR-026). */
  extensionScope?: StudioExtensionScope | null;
}) {
  const { apiGet, apiPost } = useStudioApi(extensionScope);
  const t = useTranslations("studio.debug");
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState("");

  const targets = useQuery({
    queryKey: ["studio-debug-targets", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiGet<{ targets: DebugTargetSpec[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/targets`),
  });

  const session = useQuery({
    queryKey: ["studio-debug-session", projectId, sessionId],
    enabled: Boolean(projectId) && Boolean(sessionId),
    queryFn: () =>
      apiGet<{ session: DebugSessionSnapshot }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/sessions/${encodeURIComponent(sessionId!)}`,
      ),
  });

  const start = useMutation({
    mutationFn: () =>
      apiPost<{ session: DebugSessionSnapshot; ticket: string }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/sessions`,
        { targetId, ...(relativePath.trim() ? { relativePath: relativePath.trim() } : {}) },
      ),
    onSuccess: (data) => {
      setSessionId(data.session.sessionId);
      void queryClient.invalidateQueries({ queryKey: ["studio-debug-session", projectId] });
    },
  });

  const close = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/sessions/${encodeURIComponent(sessionId!)}/close`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["studio-debug-session", projectId] });
    },
  });

  return (
    <Stack spacing={2} sx={{ maxWidth: 920 }}>
      <Typography variant="body2" sx={{ color: "#8B9099" }}>
        {t("help")}
      </Typography>

      <TextField
        select
        size="small"
        label={t("target")}
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        sx={{ maxWidth: 360 }}
      >
        {(targets.data?.targets ?? []).map((target) => (
          <MenuItem key={target.id} value={target.id}>
            {target.id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        label="relativePath"
        value={relativePath}
        onChange={(e) => setRelativePath(e.target.value)}
        sx={{ maxWidth: 360 }}
      />

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={!projectId || !targetId || start.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending ? t("requesting") : t("request")}
        </Button>
      </Stack>

      {start.isError ? (
        <Alert severity="warning">{start.error instanceof Error ? start.error.message : t("error")}</Alert>
      ) : null}

      {sessionId ? (
        <Box sx={{ border: "1px solid rgba(232,234,238,0.12)", borderRadius: 2, p: 2 }}>
          <Typography variant="subtitle2">{t("status")}</Typography>
          <Typography variant="body2" sx={{ color: "#8B9099" }}>
            {session.data?.session.status ?? "…"}
          </Typography>
          <TextField
            size="small"
            fullWidth
            label={t("reason")}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            sx={{ mt: 1, mb: 1 }}
          />
          <Button variant="outlined" disabled={close.isPending} onClick={() => close.mutate()}>
            {t("close")}
          </Button>
          {close.isSuccess ? (
            <Typography variant="caption" sx={{ display: "block", mt: 1, color: "#6FBF73" }}>
              {t("sessionClosed")}
            </Typography>
          ) : null}
          {close.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {close.error instanceof Error ? close.error.message : t("error")}
            </Alert>
          ) : null}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "#8B9099" }}>
          {t("noSession")}
        </Typography>
      )}
    </Stack>
  );
}
