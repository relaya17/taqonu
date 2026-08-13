"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface DiscoveryCandidate {
  absolutePath: string;
  folderName: string;
  matchedProjectId?: string | null;
  alreadyLinked?: boolean;
}

interface DiscoveryStatus {
  localCandidates?: DiscoveryCandidate[];
}

/**
 * Link / change the local workspace folder for a project.
 * Works for folders on this machine (API host) — paste absolute path or pick a discovered candidate.
 */
export function LinkWorkspaceRoot({
  projectId,
  currentRoot,
  compact = false,
  required = true,
}: {
  readonly projectId: string | null | undefined;
  readonly currentRoot?: string | null | undefined;
  readonly compact?: boolean;
  /** When true, show warning emphasis if unlinked. */
  readonly required?: boolean;
}) {
  const t = useTranslations("workspaceLink");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(currentRoot ?? "");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(currentRoot ?? "");
    setMessage(null);
  }, [projectId, currentRoot]);

  const discovery = useQuery({
    queryKey: ["portfolio-discovery"],
    queryFn: () => apiGet<DiscoveryStatus>("/api/v1/portfolio/discovery"),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (workspaceRoot: string | null) =>
      apiPut<{ workspaceRoot: string | null }>(
        `/api/v1/projects/${projectId}/workspace-root`,
        { workspaceRoot },
      ),
    onSuccess: async (data) => {
      setMessage(
        data.workspaceRoot ? t("saved", { path: data.workspaceRoot }) : t("cleared"),
      );
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["observer-state"] });
      await queryClient.invalidateQueries({ queryKey: ["sentinel"] });
      await queryClient.invalidateQueries({ queryKey: ["truth"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : t("error"));
    },
  });

  const linkCandidate = useMutation({
    mutationFn: (workspaceRoot: string) =>
      apiPost("/api/v1/portfolio/discovery/link", {
        projectId,
        workspaceRoot,
      }),
    onSuccess: async (_data, workspaceRoot) => {
      setDraft(workspaceRoot);
      setMessage(t("linkedCandidate"));
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-discovery"] });
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : t("error"));
    },
  });

  if (!projectId) {
    return (
      <Alert severity="info" sx={{ py: compact ? 0.5 : 1 }}>
        {t("pickProjectFirst")}
      </Alert>
    );
  }

  const linked = Boolean(currentRoot?.trim());
  const candidates = (discovery.data?.localCandidates ?? []).filter(
    (c) =>
      !c.alreadyLinked ||
      c.matchedProjectId === projectId ||
      !c.matchedProjectId,
  );

  return (
    <Box
      sx={{
        p: compact ? 1.25 : 2,
        borderRadius: 2,
        border: "1px solid",
        borderColor: linked ? "divider" : "warning.main",
        bgcolor: linked ? "transparent" : "rgba(255, 193, 7, 0.06)",
      }}
    >
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
        >
          <Typography fontWeight={650} variant={compact ? "body2" : "subtitle1"}>
            {linked ? t("linkedTitle") : required ? t("neededTitle") : t("title")}
          </Typography>
          <Button component={Link} href="/projects" size="small" variant="text">
            {t("openProjects")}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {t("help")}
        </Typography>

        {linked ? (
          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
            {currentRoot}
          </Typography>
        ) : (
          <Alert severity="warning" sx={{ py: 0.5 }}>
            {t("unlinkedWarning")}
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "flex-start" }}
        >
          <TextField
            size="small"
            fullWidth
            label={t("pathLabel")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("pathPlaceholder")}
            helperText={t("pathHelp")}
          />
          <Button
            size="small"
            variant="contained"
            disabled={save.isPending}
            onClick={() => save.mutate(draft.trim() || null)}
            sx={{ whiteSpace: "nowrap", mt: { sm: 0.5 } }}
          >
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </Stack>

        {candidates.length > 0 ? (
          <TextField
            select
            size="small"
            fullWidth
            label={t("pickDiscovered")}
            value=""
            onChange={(e) => {
              const path = e.target.value;
              if (!path) return;
              setDraft(path);
              linkCandidate.mutate(path);
            }}
          >
            <MenuItem value="" disabled>
              {t("pickDiscoveredHint")}
            </MenuItem>
            {candidates.slice(0, 40).map((c) => (
              <MenuItem key={c.absolutePath} value={c.absolutePath}>
                {c.folderName} — {c.absolutePath}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        {message ? (
          <Typography variant="caption" color="text.secondary">
            {message}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
