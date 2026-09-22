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
import { apiGet, apiPost, isApprovalRequiredError } from "@/lib/api";

interface CommandSpec {
  id: string;
  kind: "terminal" | "test" | "build";
  description: string;
  timeoutMs: number;
  pathArg?: "required" | "optional";
}

interface CatalogResponse {
  commands: CommandSpec[];
  contract: {
    unrestrictedShell: boolean;
    clientArgvAccepted: boolean;
    spawnShell: boolean;
  };
}

interface ExecutionResult {
  status: string;
  executionId?: string;
  commandId?: string;
  kind?: string | null;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  killed?: boolean;
  passed?: boolean | null;
  denial?: string;
  reason?: string;
  note?: string;
}

interface LastResponse {
  status: string;
  result: ExecutionResult | null;
}

interface ExtensionRow {
  id: string;
  name: string;
  enabled: boolean;
  hostReady: boolean;
  invocability: string;
  note: string;
}

/**
 * Governed Run tab: allowlisted commandId only. 202 means a second identity
 * must decide-and-execute. Missing Vitest is UNAVAILABLE, never PASS.
 */
export function StudioRunPanel({ projectId }: { projectId: string }) {
  const t = useTranslations("studio.run");
  const queryClient = useQueryClient();
  const [commandId, setCommandId] = useState("node.version");
  const [relativePath, setRelativePath] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [executionId, setExecutionId] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);

  const catalog = useQuery({
    queryKey: ["studio-commands", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<CatalogResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/commands`,
      ),
  });

  const last = useQuery({
    queryKey: ["studio-exec-last", projectId],
    enabled: Boolean(projectId),
    staleTime: 0,
    queryFn: () =>
      apiGet<LastResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/executions/last`,
      ),
  });

  const extensions = useQuery({
    queryKey: ["studio-extensions", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ extensions: ExtensionRow[]; note: string }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/extensions`,
      ),
  });

  const selected = catalog.data?.commands.find((c) => c.id === commandId);
  const path =
    selected?.kind === "test"
      ? `/api/v1/projects/${encodeURIComponent(projectId)}/studio/tests`
      : selected?.kind === "build"
        ? `/api/v1/projects/${encodeURIComponent(projectId)}/studio/build`
        : `/api/v1/projects/${encodeURIComponent(projectId)}/studio/terminal`;

  const requestRun = useMutation({
    mutationFn: async () => {
      try {
        return await apiPost<ExecutionResult>(path, {
          commandId,
          ...(relativePath.trim() ? { relativePath: relativePath.trim() } : {}),
        });
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setApprovalId(error.approvalId);
          if (error.executionId) setExecutionId(error.executionId);
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      setLastResult(data);
      void queryClient.invalidateQueries({ queryKey: ["studio-exec-last", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["studio-problems-tests", projectId] });
    },
  });

  const decide = useMutation({
    mutationFn: () =>
      apiPost<ExecutionResult>(`${path}/decide-and-execute`, {
        approvalId,
        decisionReason,
        commandId,
        ...(executionId ? { executionId } : {}),
        ...(relativePath.trim() ? { relativePath: relativePath.trim() } : {}),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      void queryClient.invalidateQueries({ queryKey: ["studio-exec-last", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["studio-problems-tests", projectId] });
    },
  });

  const kill = useMutation({
    mutationFn: () =>
      apiPost<{ status: string; executionId: string }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/execution/kill`,
        { executionId },
      ),
  });

  const shown = lastResult ?? last.data?.result ?? null;

  return (
    <Stack
      spacing={2}
      sx={{
        maxWidth: 920,
        "@media (prefers-reduced-motion: reduce)": {
          "& *": { animation: "none !important", transition: "none !important" },
        },
      }}
    >
      <Typography variant="body2" sx={{ color: "#8B9099" }}>
        {t("help")}
      </Typography>
      <Alert severity="info">{t("noShell")}</Alert>

      <TextField
        select
        size="small"
        label={t("command")}
        value={commandId}
        onChange={(e) => setCommandId(e.target.value)}
        sx={{ maxWidth: 360 }}
      >
        {(catalog.data?.commands ?? []).map((command) => (
          <MenuItem key={command.id} value={command.id}>
            {command.id} · {command.kind}
          </MenuItem>
        ))}
      </TextField>
      {selected?.pathArg ? (
        <TextField
          size="small"
          label="relativePath"
          value={relativePath}
          onChange={(event) => setRelativePath(event.target.value)}
          sx={{ maxWidth: 360 }}
        />
      ) : null}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disabled={!projectId || requestRun.isPending}
          onClick={() => requestRun.mutate()}
          aria-label={t("request")}
        >
          {requestRun.isPending ? t("requesting") : t("request")}
        </Button>
      </Stack>

      {catalog.isError ? (
        <Alert severity="error">
          {catalog.error instanceof Error ? catalog.error.message : t("error")}
        </Alert>
      ) : null}

      {requestRun.isError ? (
        <Alert severity="warning">
          {requestRun.error instanceof Error ? requestRun.error.message : t("error")}
        </Alert>
      ) : null}

      {approvalId ? (
        <Box sx={{ border: "1px solid rgba(232,234,238,0.12)", borderRadius: 2, p: 2 }}>
          <Typography variant="subtitle2">{t("secondIdentity")}</Typography>
          <Typography variant="caption" sx={{ display: "block", color: "#8B9099", mb: 1 }}>
            {approvalId}
          </Typography>
          <TextField
            size="small"
            fullWidth
            label={t("decisionReason")}
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
            sx={{ mb: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!decisionReason.trim() || decide.isPending}
            onClick={() => decide.mutate()}
            aria-label={t("decide")}
          >
            {t("decide")}
          </Button>
          {executionId ? (
            <Button
              color="warning"
              disabled={kill.isPending}
              onClick={() => kill.mutate()}
              sx={{ ml: 1 }}
              aria-label={t("kill")}
            >
              {t("kill")}
            </Button>
          ) : null}
          {decide.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {decide.error instanceof Error ? decide.error.message : t("error")}
            </Alert>
          ) : null}
          {kill.isError ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {kill.error instanceof Error ? kill.error.message : t("error")}
            </Alert>
          ) : null}
        </Box>
      ) : null}

      {shown ? (
        <Box sx={{ border: "1px solid rgba(232,234,238,0.12)", borderRadius: 2, p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" label={shown.status} />
            {shown.status === "TIMED_OUT" || shown.timedOut ? (
              <Chip size="small" color="warning" label={t("timedOut")} />
            ) : null}
            {shown.passed === true ? <Chip size="small" label={t("passed")} /> : null}
            {shown.passed === false ? <Chip size="small" label={t("failed")} /> : null}
            {typeof shown.exitCode === "number" ? (
              <Chip size="small" label={t("exitCode", { code: shown.exitCode })} />
            ) : null}
            {typeof shown.durationMs === "number" ? (
              <Chip size="small" variant="outlined" label={t("durationMs", { ms: shown.durationMs })} />
            ) : null}
          </Stack>
          {shown.note ? (
            <Typography variant="caption" sx={{ display: "block", mt: 1, color: "#8B9099" }}>
              {shown.note}
            </Typography>
          ) : null}
          {shown.reason ? (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {shown.reason}
            </Typography>
          ) : null}
          {shown.stdout ? (
            <Box
              component="pre"
              sx={{ mt: 1, fontSize: 12, overflow: "auto", maxHeight: 240 }}
            >
              {shown.stdout}
            </Box>
          ) : null}
          {shown.stderr ? (
            <Box>
              <Typography variant="caption" sx={{ display: "block", mt: 1, color: "#8B9099" }}>
                {t("stderr")}
              </Typography>
              <Box
                component="pre"
                sx={{ mt: 0.5, fontSize: 12, overflow: "auto", maxHeight: 160, color: "#F78C6C" }}
              >
                {shown.stderr}
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "#8B9099" }}>
          {t("notRun")}
        </Typography>
      )}

      <Box>
        <Typography variant="subtitle2">{t("extensions")}</Typography>
        <Alert severity="info" sx={{ mt: 1 }}>
          {t("extensionsHelp")}
        </Alert>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {(extensions.data?.extensions ?? []).map((ext) => (
            <Stack key={ext.id} direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={ext.hostReady ? t("hostReady") : t("noHost")} />
              <Typography variant="body2">{ext.name}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
