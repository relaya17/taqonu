"use client";

import { useState } from "react";
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useStudioApi, type StudioExtensionScope } from "@/lib/studio-extension-api";
import {
  actionErrorText,
  checkExpression,
  debugStateKey,
  debugUiActions,
  formatEvaluation,
  isTerminalStateKey,
  type DebugStateKey,
  type EvaluationView,
} from "@/lib/studio-debug-view";

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
  targetState?: string;
  createdAt: string;
  lastActivityAt: string;
}

interface DebugActionResponse {
  ok: boolean;
  state: "paused" | "running";
  evaluation?: EvaluationView;
}

type DebugActionRequest =
  | { action: "continue" }
  | { action: "pause" }
  | { action: "evaluate"; expression: string };

const STATE_MESSAGE_KEY: Record<Exclude<DebugStateKey, "none">, string> = {
  notAttached: "stateNotAttached",
  paused: "statePaused",
  running: "stateRunning",
  expired: "stateExpired",
  revoked: "stateRevoked",
  terminated: "stateTerminated",
  closed: "stateClosed",
  unavailable: "stateUnavailable",
};

/**
 * Debugger panel — Studio Evolution design (2026-10-04). Targets are
 * ArletOS-launched only (no arbitrary PID attach, no PTY-as-target). Policy
 * (P2/P3/ownership/duplicate) is fail-closed server-side — P2 has no source
 * of truth yet, so every real request here is expected to be denied with
 * `P2_INSUFFICIENT_EVIDENCE` until that Data Model decision is made
 * separately. This panel surfaces that honestly rather than hiding it.
 *
 * Resume / Pause / Evaluate are wired to the authorized Debug Session API.
 * What is shown always comes from the session the API reports (polled), and a
 * visible button is never an authorization: the API re-authorizes every action.
 * The panel never receives or renders an Inspector endpoint or a ticket.
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
  const [expression, setExpression] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);

  const sessionBase = `/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/sessions`;

  const targets = useQuery({
    queryKey: ["studio-debug-targets", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiGet<{ targets: DebugTargetSpec[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/studio/debug/targets`),
  });

  const session = useQuery({
    queryKey: ["studio-debug-session", projectId, sessionId],
    enabled: Boolean(projectId) && Boolean(sessionId),
    retry: false,
    queryFn: () => apiGet<{ session: DebugSessionSnapshot }>(`${sessionBase}/${encodeURIComponent(sessionId!)}`),
    // Polling reads the real state (it does not count as session activity). It
    // stops once the session has ended or access to it is lost.
    refetchInterval: (query) => {
      const failedWith = (query.state.error as { status?: number } | null)?.status;
      const key = debugStateKey(query.state.data?.session, failedWith);
      return key === "none" || key === "unavailable" || isTerminalStateKey(key) ? false : 2000;
    },
  });

  const lookupStatus = session.isError ? (session.error as { status?: number }).status : undefined;
  const stateKey = sessionId ? debugStateKey(session.data?.session, lookupStatus) : "none";
  const actions = debugUiActions(stateKey);

  const start = useMutation({
    mutationFn: () =>
      apiPost<{ session: DebugSessionSnapshot }>(sessionBase, {
        targetId,
        ...(relativePath.trim() ? { relativePath: relativePath.trim() } : {}),
      }),
    onSuccess: (data) => {
      setEvaluation(null);
      setSessionId(data.session.sessionId);
      void queryClient.invalidateQueries({ queryKey: ["studio-debug-session", projectId] });
    },
  });

  const close = useMutation({
    mutationFn: () => apiPost(`${sessionBase}/${encodeURIComponent(sessionId!)}/close`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["studio-debug-session", projectId] });
    },
  });

  const act = useMutation({
    mutationFn: (request: DebugActionRequest) =>
      apiPost<DebugActionResponse>(`${sessionBase}/${encodeURIComponent(sessionId!)}/action`, request),
    onSuccess: (data, request) => {
      if (request.action === "evaluate") setEvaluation(data.evaluation ?? null);
    },
    // Success or failure, re-read the real session: an action can fail because the session ended.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["studio-debug-session", projectId] });
    },
  });

  const expressionCheck = checkExpression(expression);
  const canEvaluate = actions.evaluate && expressionCheck === "ok" && !act.isPending;
  const formatted = evaluation ? formatEvaluation(evaluation) : null;

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
        <Alert severity="warning">{actionErrorText(start.error, t("error"))}</Alert>
      ) : null}

      {sessionId ? (
        <Box sx={{ border: "1px solid rgba(232,234,238,0.12)", borderRadius: 2, p: 2 }}>
          <Typography variant="subtitle2">{t("status")}</Typography>
          <Typography variant="body2" data-testid="debug-state" data-state={stateKey} sx={{ color: "#8B9099" }}>
            {stateKey === "none" ? "…" : t(STATE_MESSAGE_KEY[stateKey])}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button
              variant="contained"
              size="small"
              data-testid="debug-resume"
              disabled={!actions.resume || act.isPending}
              onClick={() => act.mutate({ action: "continue" })}
            >
              {act.isPending && act.variables?.action === "continue" ? t("working") : t("resume")}
            </Button>
            <Button
              variant="outlined"
              size="small"
              data-testid="debug-pause"
              disabled={!actions.pause || act.isPending}
              onClick={() => act.mutate({ action: "pause" })}
            >
              {act.isPending && act.variables?.action === "pause" ? t("working") : t("pause")}
            </Button>
          </Stack>

          {stateKey !== "none" && !actions.evaluate ? (
            <Typography variant="caption" data-testid="debug-no-actions" sx={{ display: "block", mt: 1, color: "#8B9099" }}>
              {t("noActions")}
            </Typography>
          ) : null}

          <TextField
            size="small"
            fullWidth
            multiline
            minRows={2}
            label={t("expression")}
            value={expression}
            disabled={!actions.evaluate}
            error={expressionCheck === "tooLong"}
            helperText={
              expressionCheck === "tooLong" ? t("expressionTooLong") : expressionCheck === "empty" && expression ? t("expressionEmpty") : t("evaluateHelp")
            }
            onChange={(e) => setExpression(e.target.value)}
            slotProps={{ htmlInput: { "data-testid": "debug-expression" } }}
            sx={{ mt: 1.5 }}
          />
          <Button
            variant="outlined"
            size="small"
            data-testid="debug-evaluate"
            disabled={!canEvaluate}
            onClick={() => act.mutate({ action: "evaluate", expression })}
            sx={{ mt: 1 }}
          >
            {act.isPending && act.variables?.action === "evaluate" ? t("working") : t("evaluate")}
          </Button>

          {act.isError ? (
            <Alert severity="warning" data-testid="debug-action-error" sx={{ mt: 1 }}>
              {t("actionFailed")}: {actionErrorText(act.error, t("actionFailed"))}
            </Alert>
          ) : null}

          {formatted ? (
            <Box
              data-testid="debug-evaluation"
              data-kind={formatted.kind}
              sx={{ mt: 1.5, p: 1, borderRadius: 1, border: "1px solid rgba(232,234,238,0.12)" }}
            >
              <Typography variant="caption" sx={{ color: formatted.kind === "exception" ? "#E57373" : "#8B9099" }}>
                {formatted.kind === "exception" ? t("exception") : `${t("result")} · ${formatted.type}`}
              </Typography>
              <Typography component="pre" variant="body2" data-testid="debug-evaluation-text" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
                {formatted.text}
              </Typography>
            </Box>
          ) : null}

          <TextField
            size="small"
            fullWidth
            label={t("reason")}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            sx={{ mt: 1.5, mb: 1 }}
          />
          <Button variant="outlined" disabled={close.isPending || !actions.close} onClick={() => close.mutate()}>
            {t("close")}
          </Button>
          {close.isSuccess ? (
            <Typography variant="caption" sx={{ display: "block", mt: 1, color: "#6FBF73" }}>
              {t("sessionClosed")}
            </Typography>
          ) : null}
          {close.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {actionErrorText(close.error, t("error"))}
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
