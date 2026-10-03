"use client";

import { Alert, Box, Button, Chip, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { isApprovalRequiredError } from "@/lib/api";
import { useStudioApi, type StudioExtensionScope } from "@/lib/studio-extension-api";
import {
  isGitBranchResult,
  isGitDiffResult,
  isGitStatusResult,
  parseGitBranchName,
  parseGitPorcelain,
} from "@/lib/studio-git-status";
import { parseUnifiedDiff, studioDiffFileFor, type StudioDiffHunk } from "@/lib/studio-diff";

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
  filePath = null,
  onFileHunksChange,
  extensionScope = null,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
  /** Currently selected editor file, scoped-diff target for hunk navigation. */
  filePath?: string | null;
  /** Called with this file's hunks whenever a scoped diff is fetched or the file changes. */
  onFileHunksChange?: (hunks: readonly StudioDiffHunk[]) => void;
  /** Set when the built-in Git extension renders this panel (ADR-026). */
  extensionScope?: StudioExtensionScope | null;
}) {
  const t = useTranslations("studio.git");
  const { apiGet, apiPost } = useStudioApi(extensionScope);
  const tRun = useTranslations("studio.run");
  const queryClient = useQueryClient();
  const [approvalId, setApprovalId] = useState("");
  const [executionId, setExecutionId] = useState("");
  const [pendingCommandId, setPendingCommandId] = useState<GitCommandId>("git.status");
  const [pendingRelativePath, setPendingRelativePath] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [scopedDiffPath, setScopedDiffPath] = useState<string | null>(null);

  // A scoped diff belongs to one file in one project; switching either
  // invalidates it so Next/Previous Change never points at a different
  // project's (or file's) hunks.
  useEffect(() => {
    setScopedDiffPath(null);
    onFileHunksChange?.([]);
    // onFileHunksChange is a per-render callback from the page, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, projectId]);

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
    mutationFn: async (input: { commandId: GitCommandId; relativePath?: string }) => {
      setPendingCommandId(input.commandId);
      setPendingRelativePath(input.relativePath ?? null);
      try {
        return await apiPost<ExecutionResult>(path, {
          commandId: input.commandId,
          ...(input.relativePath ? { relativePath: input.relativePath } : {}),
        });
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setApprovalId(error.approvalId);
          if (error.executionId) setExecutionId(error.executionId);
        }
        throw error;
      }
    },
    onSuccess: (data, variables) => {
      setLastResult(data);
      if (variables.commandId === "git.branch") {
        setBranchName(parseGitBranchName(data.stdout ?? ""));
      }
      if (variables.commandId === "git.diff") {
        setDiffText(data.stdout ?? "");
        if (variables.relativePath) {
          const files = parseUnifiedDiff(data.stdout ?? "");
          const entry = studioDiffFileFor(files, variables.relativePath);
          setScopedDiffPath(variables.relativePath);
          onFileHunksChange?.(entry?.hunks ?? []);
        } else {
          setScopedDiffPath(null);
          onFileHunksChange?.([]);
        }
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
        ...(pendingRelativePath ? { relativePath: pendingRelativePath } : {}),
      }),
    onSuccess: (data) => {
      setLastResult(data);
      if (pendingCommandId === "git.branch") {
        setBranchName(parseGitBranchName(data.stdout ?? ""));
      }
      if (pendingCommandId === "git.diff") {
        setDiffText(data.stdout ?? "");
        if (pendingRelativePath) {
          const files = parseUnifiedDiff(data.stdout ?? "");
          const entry = studioDiffFileFor(files, pendingRelativePath);
          setScopedDiffPath(pendingRelativePath);
          onFileHunksChange?.(entry?.hunks ?? []);
        } else {
          setScopedDiffPath(null);
          onFileHunksChange?.([]);
        }
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
          onClick={() => requestCommand.mutate({ commandId: "git.status" })}
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
          onClick={() => requestCommand.mutate({ commandId: "git.branch" })}
          aria-label={t("requestBranch")}
        >
          {t("requestBranch")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate({ commandId: "git.diff" })}
          aria-label={t("requestDiff")}
        >
          {t("requestDiff")}
        </Button>
        {filePath ? (
          <Button
            size="small"
            variant="outlined"
            disabled={!projectId || requestCommand.isPending}
            onClick={() => requestCommand.mutate({ commandId: "git.diff", relativePath: filePath })}
            aria-label={t("requestFileDiff")}
          >
            {requestCommand.isPending && pendingRelativePath === filePath
              ? t("requesting")
              : t("requestFileDiff")}
          </Button>
        ) : null}
        <Button
          size="small"
          variant="outlined"
          disabled={!projectId || requestCommand.isPending}
          onClick={() => requestCommand.mutate({ commandId: "git.log" })}
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
                    <ListItem key={`${change.xy}:${change.path}`} disablePadding>
                      <ListItemButton
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
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          ) : null}
          {shownDiff !== null ? (
            <Box>
              <Typography variant="caption" sx={{ color: "#8B9099" }}>
                {scopedDiffPath ? t("diffFile", { path: scopedDiffPath }) : t("diff")}
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
