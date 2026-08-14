"use client";

import { useEffect, useState } from "react";
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
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

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
  verifiedAt?: string | null;
  filesChanged: Array<{ path: string; action: string; summary: string }>;
  approvals: Array<{ by: string; at: string }>;
}

export function PatchesPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("patches");
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [root, setRoot] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const selected =
    projects.data?.items.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    if (!projectId && (projects.data?.items?.length ?? 0) > 0) {
      const first =
        projects.data!.items.find((p) => p.workspaceRoot) ??
        projects.data!.items[0]!;
      setProjectId(first.id);
      setRoot(first.workspaceRoot ?? "");
      return;
    }
    if (selected) {
      setRoot(selected.workspaceRoot ?? "");
    }
  }, [projectId, projects.data, selected]);

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

  const verify = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/remediation/drafts/${id}/verify`, {
        ...(root.trim() ? { workspaceRoot: root.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920 }}>
      {!embedded ? (
        <Box>
          <Typography variant="h1">{t("title")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("subtitle")}
          </Typography>
          <Alert severity="info" sx={{ mt: 2 }}>
            {t("gateNote")}
          </Alert>
        </Box>
      ) : (
        <Alert severity="info">{t("gateNote")}</Alert>
      )}

      <TextField
        select
        label={t("project")}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        fullWidth
      >
        {(projects.data?.items ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.workspaceRoot ? "" : ` (${t("unlinked")})`}
          </MenuItem>
        ))}
      </TextField>

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selected?.workspaceRoot}
          compact
        />
      ) : null}

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
              borderBottom: "1px solid rgba(26,31,42,0.12)",
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
              {patch.verifiedAt || patch.status === "VERIFIED" ? (
                <Chip size="small" color="success" label={t("verified")} />
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {patch.reason}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {patch.expectedImpact}
            </Typography>
            {patch.evaluationSummary ? (
              <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                {patch.evaluationSummary}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                disabled={approve.isPending}
                onClick={() => approve.mutate(patch.id)}
              >
                {t("approve")}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={apply.isPending || !root.trim()}
                onClick={() => apply.mutate(patch.id)}
              >
                {t("apply")}
              </Button>
              <Button
                size="small"
                variant="text"
                disabled={rollback.isPending || !root.trim()}
                onClick={() => rollback.mutate(patch.id)}
              >
                {t("rollback")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="success"
                disabled={verify.isPending || !root.trim()}
                onClick={() => verify.mutate(patch.id)}
              >
                {t("verify")}
              </Button>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
