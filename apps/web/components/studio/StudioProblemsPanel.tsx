"use client";

import { Alert, Box, Button, Chip, List, ListItem, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import {
  mergeStudioProblems,
  problemsFromGateNodes,
  problemsFromSentinelFindings,
  problemsFromTestRun,
  studioProblemCanOpenFile,
  studioProblemRemediationId,
  type StudioProblem,
} from "@/lib/studio-problems";

interface SentinelResponse {
  findings?: Array<{
    id: string;
    title?: string;
    detail?: string;
    severity?: string;
    kind?: string;
    path?: string;
    line?: number;
  }>;
}

interface LastExecutionResponse {
  status?: string;
  result?: {
    status?: string;
    commandId?: string;
    passed?: boolean | null;
    denial?: string;
    reason?: string;
    exitCode?: number | null;
    kind?: string | null;
  } | null;
}

interface GatesResponse {
  graph?: {
    nodes?: Array<{
      id: string;
      title: string;
      status: string;
      blockerReason: string | null;
    }>;
  };
}

export function StudioProblemsPanel({
  projectId,
  enabled,
  onOpenFile,
  onProposeFix,
}: {
  projectId: string;
  enabled: boolean;
  onOpenFile: (path: string, line: number | null, problem: StudioProblem) => void;
  onProposeFix?: (problem: StudioProblem) => void;
}) {
  const t = useTranslations("studio.problems");

  const sentinel = useQuery({
    queryKey: ["studio-problems-sentinel", projectId],
    enabled: enabled && Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () =>
      apiGet<SentinelResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sentinel`,
      ),
  });

  const gates = useQuery({
    queryKey: ["studio-problems-gates", projectId],
    enabled: enabled && Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () =>
      apiGet<GatesResponse>(
        `/api/v1/gates?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const tests = useQuery({
    queryKey: ["studio-problems-tests", projectId],
    enabled: enabled && Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () =>
      apiGet<LastExecutionResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/executions/last`,
      ),
  });

  const problems: StudioProblem[] = mergeStudioProblems(
    problemsFromSentinelFindings(sentinel.data?.findings),
    problemsFromGateNodes(gates.data?.graph?.nodes),
    problemsFromTestRun(
      tests.data?.result?.kind === "test" || tests.data?.result?.commandId === "vitest.run"
        ? tests.data.result
        : null,
      projectId,
    ),
  );

  return (
    <Box
      sx={{
        border: "1px solid rgba(232,234,238,0.12)",
        borderRadius: 3,
        p: 2.25,
        bgcolor: "rgba(28,31,38,0.92)",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>
          {t("title")}
        </Typography>
        <Chip size="small" label={String(problems.length)} />
      </Stack>
      <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "#8B9099" }}>
        {t("notCompiler")}
      </Typography>
      {sentinel.isError ? (
        <Alert severity="warning" sx={{ mt: 1.25 }}>
          {(sentinel.error as Error).message}
        </Alert>
      ) : null}
      {gates.isError ? (
        <Alert severity="warning" sx={{ mt: 1.25 }}>
          {(gates.error as Error).message}
        </Alert>
      ) : null}
      {tests.isError ? (
        <Alert severity="warning" sx={{ mt: 1.25 }}>
          {(tests.error as Error).message}
        </Alert>
      ) : null}
      {problems.length === 0 && !sentinel.isLoading && !gates.isLoading && !tests.isLoading ? (
        <Typography variant="body2" sx={{ mt: 1.25, color: "#8B9099" }}>
          {t("empty")}
        </Typography>
      ) : (
        <List dense sx={{ mt: 0.5 }}>
          {problems.map((problem) => {
          const canOpen = studioProblemCanOpenFile(problem);
          const remediationId = studioProblemRemediationId(problem);
            return (
              <ListItem
                key={problem.id}
                disablePadding
                secondaryAction={
                  remediationId && onProposeFix ? (
                    <Button
                      size="small"
                      onClick={() => onProposeFix(problem)}
                      aria-label={t("proposeFix")}
                    >
                      {t("proposeFix")}
                    </Button>
                  ) : null
                }
              >
              <ListItemButton
                disabled={!canOpen}
                onClick={() => {
                  if (problem.file) onOpenFile(problem.file, problem.line, problem);
                }}
                aria-label={
                  canOpen
                    ? `${problem.message} ${problem.file ?? ""}`
                    : problem.message
                }
              >
                <ListItemText
                  primary={problem.message}
                  secondary={`${t(`source.${problem.source}`)} · ${problem.severity}${
                    problem.file
                      ? ` · ${problem.file}${problem.line ? `:${problem.line}` : ""}`
                      : ""
                  }`}
                  primaryTypographyProps={{ sx: { color: "#DCDDE1" } }}
                  secondaryTypographyProps={{ sx: { color: "#8B9099" } }}
                />
              </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
