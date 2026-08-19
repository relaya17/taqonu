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
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

interface GithubConnectionPublic {
  kind: "github";
  id: string;
  status: ConnectionStatus;
  login: string | null;
  displayLabel: string | null;
  tokenConfigured: boolean;
  scopesHint: string | null;
  connectedAt: string | null;
  updatedAt: string;
  lastError: string | null;
}

interface LocalConnectionPublic {
  kind: "local";
  id: string;
  status: ConnectionStatus;
  reposRoot: string | null;
  displayLabel: string | null;
  connectedAt: string | null;
  updatedAt: string;
  lastError: string | null;
  lastScanAt: string | null;
  lastScanRepoCount: number | null;
}

interface ConnectionsResponse {
  github: GithubConnectionPublic | null;
  local: LocalConnectionPublic | null;
}

function statusColor(
  s: ConnectionStatus,
): "success" | "default" | "error" {
  if (s === "CONNECTED") return "success";
  if (s === "ERROR") return "error";
  return "default";
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  CONNECTED: "מחובר",
  DISCONNECTED: "מנותק",
  ERROR: "שגיאה",
};

export function ConnectionsPanel() {
  const queryClient = useQueryClient();
  const [githubToken, setGithubToken] = useState("");
  const [localReposRoot, setLocalReposRoot] = useState("");

  const connections = useQuery({
    queryKey: ["admin-connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/v1/connections"),
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-connections"] });

  const connectGithub = useMutation({
    mutationFn: () => apiPost("/api/v1/connections/github", { token: githubToken.trim() }),
    onSuccess: () => {
      setGithubToken("");
      invalidate();
    },
  });
  const disconnectGithub = useMutation({
    mutationFn: () => apiDelete("/api/v1/connections/github"),
    onSuccess: invalidate,
  });
  const connectLocal = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/connections/local", { reposRoot: localReposRoot.trim() }),
    onSuccess: () => {
      setLocalReposRoot("");
      invalidate();
    },
  });
  const disconnectLocal = useMutation({
    mutationFn: () => apiDelete("/api/v1/connections/local"),
    onSuccess: invalidate,
  });
  const scanLocal = useMutation({
    mutationFn: () => apiPost("/api/v1/connections/local/scan", {}),
    onSuccess: invalidate,
  });

  if (connections.isLoading) {
    return <Typography color="text.secondary">טוען חיבורים…</Typography>;
  }

  if (connections.isError) {
    return (
      <Alert severity="error">
        {(connections.error as Error).message ?? "נכשלה שליפת החיבורים."}
      </Alert>
    );
  }

  const github = connections.data?.github ?? null;
  const local = connections.data?.local ?? null;

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        חיבורי מקור (GitHub / תיקיה מקומית) המשמשים לגילוי פורטפוליו פרויקטים.
        לניהול מלא — עיון וייבוא ריפוזיטוריז — ראו{" "}
        <Link href="/he/integrations">אינטגרציות</Link>.
      </Typography>

      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography fontWeight={700}>GitHub</Typography>
          <Chip
            size="small"
            label={STATUS_LABEL[github?.status ?? "DISCONNECTED"]}
            color={statusColor(github?.status ?? "DISCONNECTED")}
          />
          {github?.login ? (
            <Typography variant="body2" color="text.secondary">
              {github.login}
            </Typography>
          ) : null}
        </Stack>
        {github?.lastError ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {github.lastError}
          </Alert>
        ) : null}
        {(connectGithub.isError || disconnectGithub.isError) ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {((connectGithub.error ?? disconnectGithub.error) as Error)?.message ??
              "הפעולה נכשלה."}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          {github?.status === "CONNECTED" ? (
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={disconnectGithub.isPending}
              onClick={() => disconnectGithub.mutate()}
            >
              נתק
            </Button>
          ) : (
            <>
              <TextField
                size="small"
                type="password"
                placeholder="GitHub token (read-only מומלץ)"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                sx={{ minWidth: 260 }}
              />
              <Button
                size="small"
                variant="contained"
                disabled={connectGithub.isPending || githubToken.trim().length < 8}
                onClick={() => connectGithub.mutate()}
              >
                חבר
              </Button>
            </>
          )}
        </Stack>
      </Box>

      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography fontWeight={700}>תיקיה מקומית</Typography>
          <Chip
            size="small"
            label={STATUS_LABEL[local?.status ?? "DISCONNECTED"]}
            color={statusColor(local?.status ?? "DISCONNECTED")}
          />
          {local?.reposRoot ? (
            <Typography component="code" variant="body2" color="text.secondary">
              {local.reposRoot}
            </Typography>
          ) : null}
        </Stack>
        {local?.lastScanAt ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            סריקה אחרונה: {new Date(local.lastScanAt).toLocaleString()} · נמצאו{" "}
            {local.lastScanRepoCount ?? 0} ריפוזיטוריז
          </Typography>
        ) : null}
        {local?.lastError ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {local.lastError}
          </Alert>
        ) : null}
        {(connectLocal.isError || disconnectLocal.isError || scanLocal.isError) ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {((connectLocal.error ?? disconnectLocal.error ?? scanLocal.error) as Error)
              ?.message ?? "הפעולה נכשלה."}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          {local?.status === "CONNECTED" ? (
            <>
              <Button
                size="small"
                variant="outlined"
                disabled={scanLocal.isPending}
                onClick={() => scanLocal.mutate()}
              >
                סרוק עכשיו
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={disconnectLocal.isPending}
                onClick={() => disconnectLocal.mutate()}
              >
                נתק
              </Button>
            </>
          ) : (
            <>
              <TextField
                size="small"
                placeholder="נתיב מוחלט לתיקיית ריפוזיטוריז"
                value={localReposRoot}
                onChange={(e) => setLocalReposRoot(e.target.value)}
                sx={{ minWidth: 260 }}
              />
              <Button
                size="small"
                variant="contained"
                disabled={connectLocal.isPending || localReposRoot.trim().length === 0}
                onClick={() => connectLocal.mutate()}
              >
                חבר
              </Button>
            </>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
