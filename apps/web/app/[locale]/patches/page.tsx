"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface PatchItem {
  id: string;
  title: string;
  status: string;
  risk: string;
  mode: string;
  reason: string;
  expectedImpact: string;
  evaluationSummary: string | null;
  sourceIssueId?: string | null;
  createdBy?: string;
  filesChanged: Array<{ path: string; action: string; summary: string }>;
  approvals: Array<{ by: string; at: string }>;
}

export default function PatchesPage() {
  const t = useTranslations("patches");
  const queryClient = useQueryClient();
  const [root, setRoot] = useState("C:\\Users\\User\\Desktop\\game\\taqono");

  const patches = useQuery({
    queryKey: ["patches"],
    queryFn: () => apiGet<{ items: PatchItem[] }>("/api/v1/code/patches"),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/code/patches/${id}/approve`, {
        approvedBy: "human",
        note: "UI approve",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  const apply = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/code/patches/${id}/apply`, {
        ...(root.trim() ? { workspaceRoot: root.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  const rollback = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/code/patches/${id}/rollback`, {
        workspaceRoot: root,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("gateNote")}
        </Alert>
      </Box>

      <TextField
        label={t("workspaceRoot")}
        value={root}
        onChange={(e) => setRoot(e.target.value)}
        helperText={t("workspaceHelp")}
        fullWidth
      />

      <Button component={Link} href="/agent" variant="outlined" sx={{ alignSelf: "start" }}>
        {t("openAgent")}
      </Button>

      <Stack spacing={2}>
        {(patches.data?.items ?? []).length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : null}
        {(patches.data?.items ?? []).map((patch) => (
          <Box
            key={patch.id}
            sx={{
              py: 2,
              borderBottom: "1px solid rgba(20,32,34,0.12)",
            }}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <Typography fontWeight={700}>{patch.title}</Typography>
              <Chip size="small" label={patch.status} />
              <Chip size="small" color="warning" label={patch.risk} />
              <Chip size="small" variant="outlined" label={patch.mode} />
              {patch.sourceIssueId || patch.createdBy === "atlas-auto-remediation" ? (
                <Chip size="small" color="info" label={t("autoFix")} />
              ) : null}
            </Stack>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {patch.reason}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {patch.filesChanged.map((f) => f.path).join(" · ")}
              {patch.sourceIssueId ? ` · finding ${patch.sourceIssueId}` : ""}
            </Typography>
            {patch.evaluationSummary ? (
              <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                {patch.evaluationSummary}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={
                  approve.isPending ||
                  patch.status === "APPLIED" ||
                  patch.status === "APPROVED" ||
                  patch.status === "ROLLED_BACK"
                }
                onClick={() => approve.mutate(patch.id)}
              >
                {t("approve")}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={apply.isPending || patch.status !== "APPROVED"}
                onClick={() => apply.mutate(patch.id)}
              >
                {t("apply")}
              </Button>
              <Button
                size="small"
                color="warning"
                disabled={rollback.isPending || patch.status !== "APPLIED"}
                onClick={() => rollback.mutate(patch.id)}
              >
                {t("rollback")}
              </Button>
            </Stack>
            {apply.isError ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {(apply.error as Error).message}
              </Alert>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
