"use client";

import { useMemo } from "react";
import { Alert, Button, Chip, MenuItem, Stack, TextField, Typography } from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPut, resolveApiUrl } from "@/lib/api";

export interface StudioGithubSource {
  readonly kind: "github";
  readonly repo: string;
  readonly ref: string;
  readonly repos: readonly string[];
}

interface GithubSourceStatus {
  readonly appConfigured: boolean;
  readonly connected: boolean;
  readonly repo: string | null;
  readonly installUrl: string | null;
}

/**
 * Studio's GitHub source: shows which repository the explorer is reading
 * (read-only), lets the owner switch repositories, and — when nothing is
 * connected yet — offers the one-click "Connect GitHub" install flow that
 * returns straight back to Studio.
 */
export function StudioGithubSourceBar({
  projectId,
  source,
}: {
  readonly projectId: string;
  readonly source: StudioGithubSource | null;
}) {
  const t = useTranslations("studio.github");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const installResult = searchParams.get("github_install");
  const installReason = searchParams.get("reason");

  const statusQuery = useQuery({
    queryKey: ["studio-github-source", projectId],
    enabled: Boolean(projectId),
    retry: false,
    queryFn: () =>
      apiGet<GithubSourceStatus>(
        `/api/v1/studio/github-source?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const switchRepo = useMutation({
    mutationFn: (repo: string) =>
      apiPut<{ source: StudioGithubSource }>("/api/v1/studio/github-source", {
        projectId,
        repo,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["studio-tree", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["studio-file", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["studio-github-source", projectId] });
    },
  });

  const installHref = useMemo(() => {
    const path = statusQuery.data?.installUrl;
    if (!path) return null;
    return `${resolveApiUrl()}${path}&locale=${encodeURIComponent(locale)}`;
  }, [statusQuery.data?.installUrl, locale]);

  const installAlert =
    installResult === "error" ? (
      <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
        {t("installError", { reason: installReason ?? "unknown" })}
      </Alert>
    ) : installResult === "pending" ? (
      <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
        {t("installPending")}
      </Alert>
    ) : null;

  if (source) {
    return (
      <Stack spacing={1}>
        {installAlert}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          aria-label={t("sourceLabel")}
          role="group"
        >
          <GitHubIcon fontSize="small" aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t("readingFrom")}
          </Typography>
          {source.repos.length > 1 ? (
            <TextField
              select
              size="small"
              value={source.repo}
              onChange={(e) => switchRepo.mutate(e.target.value)}
              disabled={switchRepo.isPending}
              inputProps={{ "aria-label": t("chooseRepo") }}
              sx={{ minWidth: 220 }}
            >
              {source.repos.map((repo) => (
                <MenuItem key={repo} value={repo}>
                  {repo}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" component="span" dir="ltr">
              {source.repo}
            </Typography>
          )}
          <Chip size="small" variant="outlined" label={source.ref} dir="ltr" />
          <Chip size="small" color="info" variant="outlined" label={t("readOnly")} />
          {installHref ? (
            <Button
              component="a"
              href={installHref}
              size="small"
              sx={{ textTransform: "none" }}
            >
              {t("manageAccess")}
            </Button>
          ) : null}
        </Stack>
        {switchRepo.isError ? (
          <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
            {switchRepo.error instanceof Error ? switchRepo.error.message : t("switchFailed")}
          </Alert>
        ) : null}
      </Stack>
    );
  }

  if (!statusQuery.data?.appConfigured || !installHref) {
    return installAlert;
  }

  return (
    <Stack spacing={1}>
      {installAlert}
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
        <Button
          component="a"
          href={installHref}
          variant="contained"
          size="small"
          startIcon={<GitHubIcon />}
          sx={{ textTransform: "none" }}
        >
          {statusQuery.data.connected ? t("reconnect") : t("connect")}
        </Button>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          {t("connectHint")}
        </Typography>
      </Stack>
    </Stack>
  );
}
