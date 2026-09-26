"use client";

import { Alert, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, isApprovalRequiredError } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { StudioPatchDiff } from "@/components/studio/StudioPatchDiff";
import {
  STUDIO_PATCH_STEPS,
  canApplyStudioPatch,
  canApproveStudioPatch,
  canRollbackStudioPatch,
  canVerifyStudioPatch,
  nextStudioPatchStep,
  patchDecideAndExecutePath,
  patchGovernedPath,
  patchVerifyPath,
} from "@/lib/studio-patch-workflow";
import {
  formatPatchVerifyLabel,
  studioRemediationAlertSeverity,
  studioRemediationIsGreen,
} from "@/lib/studio-remediation-truth";

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
  filesChanged: Array<{
    path: string;
    action: string;
    summary: string;
    unifiedDiff?: string;
    afterContent?: string;
  }>;
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
  const [pendingRollbackById, setPendingRollbackById] = useState<
    Record<string, string>
  >({});
  const [decisionReason, setDecisionReason] = useState("");

  const patches = useQuery({
    queryKey: ["patches", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ items: PatchItem[] }>(
        `/api/v1/code/patches?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const session = useQuery({
    queryKey: ["studio-patch-identity"],
    queryFn: () =>
      apiGet<{
        authenticated: boolean;
        user: { id: string; email: string } | null;
      }>("/api/v1/auth/session"),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!projectId || !focusPatchId) return;
    void queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
  }, [focusPatchId, projectId, queryClient]);

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
      await queryClient.invalidateQueries({ queryKey: ["studio-file"] });
      await queryClient.invalidateQueries({ queryKey: ["studio-tree"] });
      onVerified?.();
    },
  });

  const rollback = useMutation({
    mutationFn: async (id: string) => {
      try {
        return await apiPost(
          patchGovernedPath(id, "rollback", pendingRollbackById[id]),
          {
            ...(root ? { workspaceRoot: root } : {}),
          },
        );
      } catch (error) {
        if (isApprovalRequiredError(error)) {
          setPendingRollbackById((current) => ({
            ...current,
            [id]: error.approvalId,
          }));
        }
        throw error;
      }
    },
    onSuccess: async (_data, id) => {
      setPendingRollbackById((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["studio-file"] });
      await queryClient.invalidateQueries({ queryKey: ["studio-tree"] });
    },
  });

  const decide = useMutation({
    mutationFn: (input: {
      id: string;
      action: "apply" | "rollback";
      approvalId: string;
    }) =>
      apiPost(patchDecideAndExecutePath(input.id, input.action), {
        approvalId: input.approvalId,
        decisionReason: decisionReason.trim(),
        workspaceRoot: root,
      }),
    onSuccess: async (_data, input) => {
      const clear = (current: Record<string, string>) => {
        const next = { ...current };
        delete next[input.id];
        return next;
      };
      if (input.action === "apply") setPendingApplyById(clear);
      else setPendingRollbackById(clear);
      setDecisionReason("");
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["studio-file"] });
      await queryClient.invalidateQueries({ queryKey: ["studio-tree"] });
    },
  });

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const result = await apiPost<{
        patch?: { status?: string };
        verify?: { ok?: boolean; summary?: string };
        patchVerifyStatus?: string;
        findingRemediation?: {
          result: string;
          verifyStatus: string;
          findingPresence: string;
          summary: string;
        };
      }>(patchVerifyPath(id), {
        projectId,
        ...(root ? { workspaceRoot: root } : {}),
      });
      if (result?.verify && result.verify.ok === false) {
        throw new Error(result.verify.summary || t("workflow.verifyFailed"));
      }
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      onVerified?.();
    },
  });

  const busy =
    approve.isPending ||
    apply.isPending ||
    verify.isPending ||
    rollback.isPending ||
    decide.isPending;
  const actionError = approve.error || apply.error || verify.error || rollback.error;

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
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "#8B9099" }}>
        {t("workflow.rollbackHelp")}
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
        <Alert
          severity={studioRemediationAlertSeverity(
            verify.data?.verify?.ok !== false,
            verify.data?.findingRemediation,
          )}
          sx={{ mt: 1.5 }}
        >
          {tPatches("verifyStatus", {
            status: formatPatchVerifyLabel(
              verify.data?.patchVerifyStatus,
              verify.data?.verify?.ok,
            ),
          })}
          {verify.data?.findingRemediation
            ? ` · ${tPatches("remediationLine", {
                result: verify.data.findingRemediation.result,
                finding: verify.data.findingRemediation.findingPresence,
              })}`
            : ""}
          {studioRemediationIsGreen(
            verify.data?.verify?.ok !== false,
            verify.data?.findingRemediation,
          )
            ? ` — ${tPatches("remediationFixed")}`
            : verify.data?.findingRemediation?.result === "NOT_FIXED" ||
                verify.data?.findingRemediation?.result === "UNSUPPORTED"
              ? ` — ${tPatches("remediationNotFixed")}`
              : ` — ${tPatches("patchVerifyOnly")}`}
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
          {pendingRollbackById[focused.id] ? (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {tPatches("approvalPending", { id: pendingRollbackById[focused.id] })}
            </Alert>
          ) : null}
          {pendingApplyById[focused.id] || pendingRollbackById[focused.id] ? (
            <Box
              sx={{
                mt: 1.5,
                p: 1.5,
                border: "1px solid rgba(232,234,238,0.12)",
                borderRadius: 2,
              }}
            >
              <Typography variant="subtitle2" sx={{ color: "#DCDDE1" }}>
                {t("workflow.secondIdentity")}
              </Typography>
              <Typography variant="caption" sx={{ display: "block", color: "#8B9099", mt: 0.5 }}>
                {t("workflow.secondIdentityHelp")}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: "#DCDDE1" }}>
                {t("workflow.currentIdentity")}: {session.data?.user?.email ?? "—"}
              </Typography>
              <TextField
                size="small"
                fullWidth
                label={t("workflow.decisionReason")}
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                sx={{ mt: 1 }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                {pendingApplyById[focused.id] ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={
                      decide.isPending || !root || decisionReason.trim().length === 0
                    }
                    onClick={() =>
                      decide.mutate({
                        id: focused.id,
                        action: "apply",
                        approvalId: pendingApplyById[focused.id] ?? "",
                      })
                    }
                  >
                    {t("workflow.decideApply")}
                  </Button>
                ) : null}
                {pendingRollbackById[focused.id] ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={
                      decide.isPending || !root || decisionReason.trim().length === 0
                    }
                    onClick={() =>
                      decide.mutate({
                        id: focused.id,
                        action: "rollback",
                        approvalId: pendingRollbackById[focused.id] ?? "",
                      })
                    }
                  >
                    {t("workflow.decideRollback")}
                  </Button>
                ) : null}
              </Stack>
              {decide.isError ? (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {(decide.error as Error).message}
                </Alert>
              ) : null}
            </Box>
          ) : null}
          {decide.isSuccess ? (
            <Alert severity="success" sx={{ mt: 1.5 }}>
              {t("workflow.sodExecuted")}
            </Alert>
          ) : null}
          <StudioPatchDiff filesChanged={focused.filesChanged} />
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
            <Button
              size="small"
              variant="outlined"
              color="warning"
              disabled={busy || !canRollbackStudioPatch(focused.status) || !root}
              onClick={() => rollback.mutate(focused.id)}
              aria-label={tPatches("rollback")}
            >
              {pendingRollbackById[focused.id]
                ? tPatches("retryRollback")
                : tPatches("rollback")}
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
