"use client";

import { Alert, Box, Button, Chip, List, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, isApprovalRequiredError } from "@/lib/api";
import { isGitStatusResult, parseGitPorcelain } from "@/lib/studio-git-status";

interface ExecutionResult {
  status: string;
  executionId?: string;
  commandId?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  passed?: boolean | null;
  denial?: string;
  reason?: string;
  note?: string;
}

interface LastResponse {
  status: string;
  result: ExecutionResult | null;
}

/**
 * Read-only Git change list from the last governed `git.status` run.
 * Refresh uses the same terminal SoD path as Run. Never commits.
 */
export function StudioGitStatus({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("studio.git");
  const tRun = useTranslations("studio.run");
  const queryClient = useQueryClient();
  const [approvalId, setApprovalId] = useState("");
  const [executionId, setExecutionId] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);

  const last = useQuery({
    queryKey: ["studio-exec-last", projectId],
    enabled: Boolean(projectId),
    staleTime: 0,
    queryFn: () =>
      apiGet<LastResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/executions/last`,
      ),
  });

  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/studio/terminal`;

  const requestStatus = useMutation({
    mutationFn: async () => {
      try {
        return await apiPost<ExecutionResult>(path, { commandId: "git.status" });
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
    },
  });

  const decide = useMutation({
    mutationFn: () =>
      apiPost<ExecutionResult>(`${path}/decide-and-execute`, {
        approvalId,
        decisionReason,
        commandId: "git.status",
        ...(executionId ? { executionId } : {}),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      void queryClient.invalidateQueries({ queryKey: ["studio-exec-last", projectId] });
    },
  });

  const shown = lastResult ?? last.data?.result ?? null;
  const gitResult = isGitStatusResult(shown) ? shown : null;
  const changes = gitResult?.stdout ? parseGitPorcelain(gitResult.stdout) : [];

  return (
    <Box
      component="section"
      aria-label={t("title")}
      sx={{
        border: "1px solid rgba(232,234,238,0.12)",
        borderRadius: 2,
        p: 1.5,
        bgcolor: "rgba(20,22,28,0.65)",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
          {t("title")}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestStatus.isPending}
          onClick={() => requestStatus.mutate()}
          aria-label={t("request")}
        >
          {requestStatus.isPending ? t("requesting") : t("request")}
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "#8B9099" }}>
        {t("help")}
      </Typography>

      {requestStatus.isError ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {requestStatus.error instanceof Error ? requestStatus.error.message : tRun("error")}
        </Alert>
      ) : null}

      {approvalId ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="caption" sx={{ display: "block", color: "#8B9099" }}>
            {tRun("secondIdentity")}
          </Typography>
          <TextField
            size="small"
            fullWidth
            label={tRun("decisionReason")}
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
            sx={{ mt: 0.75 }}
          />
          <Button
            size="small"
            variant="outlined"
            disabled={!decisionReason.trim() || decide.isPending}
            onClick={() => decide.mutate()}
            sx={{ mt: 0.75 }}
            aria-label={tRun("decide")}
          >
            {tRun("decide")}
          </Button>
          {decide.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {decide.error instanceof Error ? decide.error.message : tRun("error")}
            </Alert>
          ) : null}
        </Box>
      ) : null}

      {!gitResult ? (
        <Typography variant="body2" sx={{ mt: 1, color: "#8B9099" }}>
          {t("empty")}
        </Typography>
      ) : (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" label={gitResult.status} />
            {typeof gitResult.exitCode === "number" ? (
              <Chip size="small" label={`exit ${gitResult.exitCode}`} />
            ) : null}
          </Stack>
          <Typography variant="caption" sx={{ color: "#8B9099" }}>
            {t("notTruth")}
          </Typography>
          {changes.length === 0 ? (
            <Typography variant="body2" sx={{ color: "#8B9099" }}>
              {gitResult.exitCode === 0
                ? t("clean")
                : gitResult.stderr || gitResult.reason || t("empty")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {changes.map((change) => (
                <ListItemButton
                  key={`${change.xy}:${change.path}`}
                  onClick={() => onOpenFile(change.path)}
                  sx={{ borderRadius: 1, py: 0.25 }}
                >
                  <ListItemText
                    primary={change.path}
                    secondary={t(`kind.${change.kind}`)}
                    primaryTypographyProps={{ sx: { color: "#DCDDE1", fontSize: 13 } }}
                    secondaryTypographyProps={{ sx: { color: "#8B9099", fontSize: 11 } }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Stack>
      )}
    </Box>
  );
}
