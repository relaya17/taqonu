"use client";

import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, isApprovalRequiredError } from "@/lib/api";
import { Link } from "@/i18n/routing";
import {
  STUDIO_PATCH_STEPS,
  canApplyStudioPatch,
  canApproveStudioPatch,
  canVerifyStudioPatch,
  nextStudioPatchStep,
  patchGovernedPath,
  patchVerifyPath,
} from "@/lib/studio-patch-workflow";

interface PatchItem {
  id: string;
  title: string;
  status: string;
  risk: string;
  mode: string;
  reason: string;
  expectedImpact: string;
  evaluationSummary: string | null;
  verifiedAt?: string | null;
  filesChanged: Array<{ path: string; action: string; summary: string }>;
  approvals: Array<{ by: string; at: string }>;
}

/**
 * Studio-local inspect → analyze → propose → review → approve → apply → verify.
 * Uses existing /api/v1/code/patches governance. Apply stays disabled until
 * approve succeeds; agents cannot write protected code from this panel.
 */
export function StudioPatchWorkflow({
  projectId,
  workspaceRoot,
  focusPatchId,
  onVerified,
}: {
  projectId: string;
  workspaceRoot: string | null | undefined;
  focusPatchId: string | null;
  onVerified?: () => void;
}) {
  const t = useTranslations("studio");
  const tPatches = useTranslations("patches");
  const queryClient = useQueryClient();
  const root = workspaceRoot?.trim() ?? "";

  const [pendingApplyById, setPendingApplyById] = useState<Record<string, string>>(
    {},
  );

  const patches = useQuery({
    queryKey: ["patches", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ items: PatchItem[] }>(
        `/api/v1/code/patches?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const items = patches.data?.items ?? [];
  const focused =
    items.find((p) => p.id === focusPatchId) ??
    items.find((p) => p.status !== "VERIFIED" && p.status !== "ROLLED_BACK") ??
    items[0] ??
    null;
  const currentStep = nextStudioPatchStep(focused?.status);

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/code/patches/${id}/approve`, {
        approvedBy: "human",
        note: "Studio approve",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
    },
  });

  const apply = useMutation({
    mutationFn: async (id: string) => {
      try {
        return await apiPost(patchGovernedPath(id, "apply", pendingApplyById[id]), {
          ...(root ? { workspaceRoot: root } : {}),
        });
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setPendingApplyById((current) => ({
            ...current,
            [id]: error.approvalId,
          }));
        }
        throw error;
      }
    },
    onSuccess: async (_data, id) => {
      setPendingApplyById((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      onVerified?.();
    },
  });

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const result = await apiPost<{
        patch?: { status?: string };
        verify?: { ok?: boolean; summary?: string };
      }>(patchVerifyPath(id), {
        projectId,
        ...(root ? { workspaceRoot: root } : {}),
      });
      if (result?.verify && result.verify.ok === false) {
        throw new Error(result.verify.summary || "Verification failed");
      }
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      onVerified?.();
    },
  });

  const busy = approve.isPending || apply.isPending || verify.isPending;
  const actionError = approve.error || apply.error || verify.error;

  return (
    <Box
      sx={{
        border: "1px solid rgba(232,234,238,0.12)",
        borderRadius: 3,
        p: 2.25,
        bgcolor: "rgba(28,31,38,0.92)",
      }}
    >
      <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>
        {t("workflow.title")}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, color: "#8B9099" }}>
        {t("workflow.help")}
      </Typography>
      <Alert severity="info" sx={{ mt: 1.5 }}>
        {tPatches("gateNote")}
      </Alert>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        {STUDIO_PATCH_STEPS.map((step) => (
          <Chip
            key={step}
            size="small"
            color={step === currentStep ? "primary" : "default"}
            variant={step === currentStep ? "filled" : "outlined"}
            label={t(`workflow.steps.${step}`)}
            sx={{ color: "#DCDDE1", borderColor: "rgba(232,234,238,0.25)" }}
          />
        ))}
      </Stack>

      {patches.isError ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {(patches.error as Error).message}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {(actionError as Error).message}
        </Alert>
      ) : null}
      {verify.isSuccess && !verify.isError ? (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {tPatches("verified")}
        </Alert>
      ) : null}

      {!focused ? (
        <Typography variant="body2" sx={{ mt: 1.5, color: "#8B9099" }}>
          {t("workflow.empty")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.75 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>
              {focused.title}
            </Typography>
            <Chip size="small" label={focused.status} />
            <Chip size="small" label={focused.risk} />
            <Chip size="small" variant="outlined" label={focused.mode} />
          </Stack>
          <Typography variant="body2" sx={{ mt: 0.75, color: "#8B9099" }}>
            {focused.reason}
          </Typography>
          {focused.expectedImpact ? (
            <Typography variant="body2" sx={{ mt: 0.5, color: "#DCDDE1" }}>
              {focused.expectedImpact}
            </Typography>
          ) : null}
          {focused.evaluationSummary ? (
            <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "#8B9099" }}>
              {focused.evaluationSummary}
            </Typography>
          ) : null}
          {pendingApplyById[focused.id] ? (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {tPatches("approvalPending", { id: pendingApplyById[focused.id] })}
            </Alert>
          ) : null}
          <Typography variant="overline" sx={{ display: "block", mt: 1.25, color: "#8B9099" }}>
            {t("workflow.reviewFiles")}
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {focused.filesChanged.map((file) => (
              <Typography key={`${file.action}:${file.path}`} variant="body2" sx={{ color: "#DCDDE1" }}>
                {file.action} · {file.path}
                {file.summary ? ` — ${file.summary}` : ""}
              </Typography>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="outlined"
              disabled={busy || !canApproveStudioPatch(focused.status)}
              onClick={() => approve.mutate(focused.id)}
            >
              {tPatches("approve")}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={busy || !canApplyStudioPatch(focused.status) || !root}
              onClick={() => apply.mutate(focused.id)}
            >
              {pendingApplyById[focused.id]
                ? tPatches("retryApply")
                : tPatches("apply")}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={busy || !canVerifyStudioPatch(focused.status) || !root}
              onClick={() => verify.mutate(focused.id)}
            >
              {tPatches("verify")}
            </Button>
            <Button component={Link} href="/patches" size="small" variant="text">
              {t("openPatches")}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
