"use client";

import { Alert, Box, Button, Chip, List, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, isApprovalRequiredError } from "@/lib/api";
import {
  isGitBranchResult,
  isGitDiffResult,
  isGitStatusResult,
  parseGitBranchName,
  parseGitPorcelain,
} from "@/lib/studio-git-status";

type GitCommandId =
  | "git.status"
  | "git.branch"
  | "git.diff"
  | "git.log"
  | "git.blame"
  | "git.add"
  | "git.unstage"
  | "git.restore";

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
 * Read-only Git surfaces from governed commandIds.
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
  const [pendingCommandId, setPendingCommandId] = useState<GitCommandId>("git.status");
  const [decisionReason, setDecisionReason] = useState("");
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);

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

  const requestCommand = useMutation({
    mutationFn: async (commandId: GitCommandId) => {
      setPendingCommandId(commandId);
      try {
        return await apiPost<ExecutionResult>(path, { commandId });
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setApprovalId(error.approvalId);
          if (error.executionId) setExecutionId(error.executionId);
        }
        throw error;
      }
    },
    onSuccess: (data, commandId) => {
      setLastResult(data);
      if (commandId === "git.branch") {
        setBranchName(parseGitBranchName(data.stdout ?? ""));
      }
      if (commandId === "git.diff") {
        setDiffText(data.stdout ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["studio-exec-last", projectId] });
    },
  });

  const decide = useMutation({
    mutationFn: () =>
      apiPost<ExecutionResult>(`${path}/decide-and-execute`, {
        approvalId,
        decisionReason,
        commandId: pendingCommandId,
        ...(executionId ? { executionId } : {}),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      if (pendingCommandId === "git.branch") {
        setBranchName(parseGitBranchName(data.stdout ?? ""));
      }
      if (pendingCommandId === "git.diff") {
        setDiffText(data.stdout ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["studio-exec-last", projectId] });
    },
  });

  const shown = lastResult ?? last.data?.result ?? null;
  const gitResult = isGitStatusResult(shown) ? shown : null;
  const changes = gitResult?.stdout ? parseGitPorcelain(gitResult.stdout) : [];
  const shownBranch =
    branchName ??
    (shown && isGitBranchResult(shown) ? parseGitBranchName(shown.stdout ?? "") : null);
  const shownDiff =
    diffText ?? (shown && isGitDiffResult(shown) ? shown.stdout ?? "" : null);

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
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate("git.status")}
          aria-label={t("request")}
        >
          {requestCommand.isPending && pendingCommandId === "git.status"
            ? t("requesting")
            : t("request")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate("git.branch")}
          aria-label={t("requestBranch")}
        >
          {t("requestBranch")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate("git.diff")}
          aria-label={t("requestDiff")}
        >
          {t("requestDiff")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate("git.log")}
        >
          git.log
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "#8B9099" }}>
        {t("help")}
      </Typography>

      {requestCommand.isError ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {requestCommand.error instanceof Error ? requestCommand.error.message : tRun("error")}
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

      {shownBranch ? (
        <Chip size="small" label={`${t("branch")}: ${shownBranch}`} sx={{ mt: 1 }} />
      ) : null}

      {!gitResult && !shownDiff ? (
        <Typography variant="body2" sx={{ mt: 1, color: "#8B9099" }}>
          {t("empty")}
        </Typography>
      ) : (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {gitResult ? (
            <>
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" label={gitResult.status} />
                {typeof gitResult.exitCode === "number" ? (
                  <Chip size="small" label={t("exitCode", { code: gitResult.exitCode })} />
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
            </>
          ) : null}
          {shownDiff !== null ? (
            <Box>
              <Typography variant="caption" sx={{ color: "#8B9099" }}>
                {t("diff")}
              </Typography>
              <Box
                component="pre"
                dir="ltr"
                sx={{
                  mt: 0.5,
                  p: 1,
                  maxHeight: 220,
                  overflow: "auto",
                  fontSize: 12,
                  color: "#DCDDE1",
                  bgcolor: "rgba(0,0,0,0.35)",
                  borderRadius: 1,
                }}
              >
                {shownDiff.trim() ? shownDiff : t("diffEmpty")}
              </Box>
            </Box>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}
