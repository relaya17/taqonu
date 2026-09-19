"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import {
  pickLatestStudioPatch,
  studioContinuityView,
} from "@/lib/studio-continuity";

interface PatchList {
  items?: Array<{ id: string; title: string; status: string }>;
}

interface LastRun {
  result?: {
    commandId?: string;
    status?: string;
    passed?: boolean | null;
  } | null;
}

interface CostSummary {
  totalUsd?: number;
  runCount?: number;
  note?: string;
}

/**
 * Atlas-native "where this project is" strip. Uses existing project-scoped
 * APIs only. Cost is recorded audit totals, never an estimate. Approvals
 * stay on the live SoD path — this panel does not list Control approvals.
 */
export function StudioContinuity({
  projectId,
  boundFindingId,
}: {
  projectId: string;
  boundFindingId: string | null;
}) {
  const t = useTranslations("studio.continuity");

  const patches = useQuery({
    queryKey: ["patches", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<PatchList>(
        `/api/v1/code/patches?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const lastRun = useQuery({
    queryKey: ["studio-exec-last", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<LastRun>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/executions/last`,
      ),
  });

  const cost = useQuery({
    queryKey: ["studio-cost", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<CostSummary>(
        `/api/v1/cost-intelligence?projectId=${encodeURIComponent(projectId)}`,
      ),
    retry: false,
  });

  const view = studioContinuityView({
    lastPatch: pickLatestStudioPatch(patches.data?.items),
    lastRun: lastRun.data?.result
      ? {
          ...(lastRun.data.result.commandId
            ? { commandId: lastRun.data.result.commandId }
            : {}),
          status: lastRun.data.result.status ?? "UNKNOWN",
          ...(lastRun.data.result.passed !== undefined
            ? { passed: lastRun.data.result.passed }
            : {}),
        }
      : null,
    cost:
      cost.data && typeof cost.data.totalUsd === "number"
        ? {
            totalUsd: cost.data.totalUsd,
            runCount: cost.data.runCount ?? 0,
            note: cost.data.note ?? "",
          }
        : null,
    boundFindingId,
  });

  return (
    <Box
      component="section"
      aria-label={t("title")}
      sx={{
        border: "1px solid rgba(232,234,238,0.12)",
        borderRadius: 2,
        p: 1.5,
        bgcolor: "rgba(20,22,28,0.55)",
      }}
    >
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
        {t("title")}
      </Typography>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "#8B9099" }}>
        {t("help")}
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        <Chip
          size="small"
          label={
            view.patchStatus
              ? `${t("patch")}: ${view.patchStatus}`
              : t("noPatch")
          }
        />
        <Chip
          size="small"
          label={
            view.runCommand
              ? `${view.runCommand}: ${view.runStatus ?? ""}`
              : t("noRun")
          }
        />
        <Chip
          size="small"
          label={
            view.costUsd === null
              ? t("costUnknown")
              : `${t("cost")}: ${view.costUsd} (${view.costRuns ?? 0})`
          }
        />
        {view.boundFindingId ? (
          <Chip size="small" color="warning" label={`${t("finding")}: ${view.boundFindingId}`} />
        ) : null}
      </Stack>
    </Box>
  );
}
