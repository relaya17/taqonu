"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

interface ConnectionsResponse {
  github: {
    status: string;
    login: string | null;
    displayLabel: string | null;
    tokenConfigured: boolean;
    lastError: string | null;
  } | null;
  local: {
    status: string;
    reposRoot: string | null;
    displayLabel: string | null;
    lastScanRepoCount: number | null;
    lastError: string | null;
  } | null;
}

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [reposRoot, setReposRoot] = useState("");

  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/v1/connections"),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["connections"] });
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    await queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
  };

  const connectGithub = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/connections/github", { token: token.trim() }),
    onSuccess: async () => {
      setToken("");
      await invalidate();
    },
  });

  const disconnectGithub = useMutation({
    mutationFn: () => apiDelete("/api/v1/connections/github"),
    onSuccess: invalidate,
  });

  const importGithub = useMutation({
    mutationFn: () =>
      apiPost<{ imported: number; created: number; updated: number }>(
        "/api/v1/connections/github/import",
        { reconcile: true },
      ),
    onSuccess: invalidate,
  });

  const connectLocal = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/connections/local", {
        reposRoot: reposRoot.trim(),
      }),
    onSuccess: async () => {
      await invalidate();
    },
  });

  const disconnectLocal = useMutation({
    mutationFn: () => apiDelete("/api/v1/connections/local"),
    onSuccess: invalidate,
  });

  const scanLocal = useMutation({
    mutationFn: () =>
      apiPost<{ scanned: number; created: number; updated: number }>(
        "/api/v1/connections/local/scan",
        { reconcile: true },
      ),
    onSuccess: invalidate,
  });

  const github = connections.data?.github;
  const local = connections.data?.local;
  const githubConnected = github?.status === "CONNECTED";
  const localConnected =
    local?.status === "CONNECTED" || local?.status === "ERROR";

  return (
    <Stack spacing={4} sx={{ maxWidth: 760 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Box
        sx={{
          borderBottom: "1px solid rgba(20,32,34,0.12)",
          pb: 3,
        }}
      >
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("githubTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("githubHelp")}
        </Typography>
        {githubConnected ? (
          <Stack spacing={1.5}>
            <Alert severity="success">
              {t("githubConnected", { login: github?.login ?? "—" })}
            </Alert>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => importGithub.mutate()}
                disabled={importGithub.isPending}
              >
                {t("importRepos")}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => disconnectGithub.mutate()}
                disabled={disconnectGithub.isPending}
              >
                {t("disconnect")}
              </Button>
            </Stack>
            {importGithub.isSuccess ? (
              <Typography variant="body2">
                {t("importResult", {
                  imported: importGithub.data.imported,
                  created: importGithub.data.created,
                  updated: importGithub.data.updated,
                })}
              </Typography>
            ) : null}
            {github?.lastError ? (
              <Alert severity="warning">{github.lastError}</Alert>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <TextField
              type="password"
              label={t("tokenLabel")}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              helperText={t("tokenHelper")}
              fullWidth
              autoComplete="off"
            />
            <Button
              variant="contained"
              onClick={() => connectGithub.mutate()}
              disabled={connectGithub.isPending || token.trim().length < 8}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("connectGithub")}
            </Button>
            {connectGithub.isError ? (
              <Alert severity="error">
                {(connectGithub.error as Error).message}
              </Alert>
            ) : null}
          </Stack>
        )}
      </Box>

      <Box>
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("localTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("localHelp")}
        </Typography>
        {localConnected && local?.reposRoot ? (
          <Stack spacing={1.5}>
            <Alert severity={local.status === "ERROR" ? "warning" : "success"}>
              {t("localConnected", { path: local.reposRoot })}
              {local.lastScanRepoCount != null
                ? ` · ${t("lastScan", { count: local.lastScanRepoCount })}`
                : ""}
            </Alert>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => scanLocal.mutate()}
                disabled={scanLocal.isPending}
              >
                {t("scanLocal")}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => disconnectLocal.mutate()}
                disabled={disconnectLocal.isPending}
              >
                {t("disconnect")}
              </Button>
            </Stack>
            {scanLocal.isSuccess ? (
              <Typography variant="body2">
                {t("scanResult", {
                  scanned: scanLocal.data.scanned,
                  created: scanLocal.data.created,
                  updated: scanLocal.data.updated,
                })}
              </Typography>
            ) : null}
            {local.lastError ? (
              <Alert severity="warning">{local.lastError}</Alert>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <TextField
              label={t("pathLabel")}
              value={reposRoot}
              onChange={(event) => setReposRoot(event.target.value)}
              helperText={t("pathHelper")}
              fullWidth
              placeholder="C:\\Users\\You\\Desktop\\repos"
            />
            <Button
              variant="contained"
              onClick={() => connectLocal.mutate()}
              disabled={connectLocal.isPending || reposRoot.trim().length < 2}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("connectLocal")}
            </Button>
            {connectLocal.isError ? (
              <Alert severity="error">
                {(connectLocal.error as Error).message}
              </Alert>
            ) : null}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
