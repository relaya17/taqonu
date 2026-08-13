"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { API_URL, apiDelete, apiGet, apiPost } from "@/lib/api";

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

interface GithubAppInstallation {
  installationId: string;
  projectId: string | null;
  accountLogin: string | null;
  accountType: string | null;
  targetType: string | null;
  repositorySelection: string | null;
  setupAction: string | null;
  suspendedAt: string | null;
  installedAt: string;
  updatedAt: string;
}

interface GithubAppStatus {
  provider: string;
  installation: "not_configured" | "configured" | "webhook_ready" | "active";
  installationStates: Record<string, string>;
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  appSlug: string | null;
  setupUrl: string | null;
  setupUrlNote: string | null;
  /** Backend path that signs state + redirects to GitHub's install page. */
  installUrl: string | null;
  installations: GithubAppInstallation[];
  lastWebhookAt: string | null;
  lastSyncAt: string | null;
  mvpNote: string;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
}

interface DbFeedItem {
  provider: "supabase" | "mongodb";
  summary: string;
  tableOrCollectionCount: number;
  observedAt: string;
  host?: string | null;
}

interface DeployFeedItem {
  provider: "vercel" | "render";
  summary: string;
  environment: string;
  status: string;
  observedAt: string;
  url?: string | null;
}

interface FeedsResponse {
  items: DbFeedItem[];
  deployment: DeployFeedItem[];
}

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [reposRoot, setReposRoot] = useState("");
  const [feedProjectId, setFeedProjectId] = useState("");
  const [supabaseHost, setSupabaseHost] = useState("");
  const [supabaseTables, setSupabaseTables] = useState("");
  const [supabaseRls, setSupabaseRls] = useState(true);
  const [mongoHost, setMongoHost] = useState("");
  const [mongoDb, setMongoDb] = useState("");
  const [mongoCollections, setMongoCollections] = useState("");
  const [vercelProjectName, setVercelProjectName] = useState("");
  const [vercelUrl, setVercelUrl] = useState("");
  const [vercelEnv, setVercelEnv] = useState<
    "production" | "preview" | "development"
  >("production");
  const [vercelState, setVercelState] = useState<
    "READY" | "ERROR" | "BUILDING" | "QUEUED" | "UNKNOWN"
  >("READY");
  const [vercelSha, setVercelSha] = useState("");
  const [renderServiceName, setRenderServiceName] = useState("");
  const [renderUrl, setRenderUrl] = useState("");
  const [renderEnv, setRenderEnv] = useState<
    "production" | "preview" | "development"
  >("production");
  const [renderStatus, setRenderStatus] = useState<
    "live" | "build_failed" | "suspended" | "deploying" | "unknown"
  >("live");
  const [renderSha, setRenderSha] = useState("");

  const githubInstallStatus = searchParams.get("github_install");
  const githubInstallReason = searchParams.get("reason");
  const githubInstallationId = searchParams.get("installation_id");

  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/v1/connections"),
  });

  const githubApp = useQuery({
    queryKey: ["github-app"],
    queryFn: () => apiGet<GithubAppStatus>("/api/v1/github"),
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectRow[] }>("/api/v1/projects"),
  });

  const dbFeeds = useQuery({
    queryKey: ["db-feeds", feedProjectId],
    queryFn: () =>
      apiGet<FeedsResponse>(`/api/v1/feeds/${feedProjectId}`),
    enabled: feedProjectId.length > 0,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["connections"] });
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    await queryClient.invalidateQueries({ queryKey: ["github-app"] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    await queryClient.invalidateQueries({ queryKey: ["portfolio-overview"] });
    await queryClient.invalidateQueries({ queryKey: ["db-feeds"] });
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

  const postSupabaseFeed = useMutation({
    mutationFn: () => {
      const tables = supabaseTables
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return apiPost("/api/v1/feeds/supabase", {
        projectId: feedProjectId,
        hostLabel: supabaseHost.trim(),
        tables,
        rlsEnabled: supabaseRls,
      });
    },
    onSuccess: invalidate,
  });

  const postMongoFeed = useMutation({
    mutationFn: () => {
      const collections = mongoCollections
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return apiPost("/api/v1/feeds/mongodb", {
        projectId: feedProjectId,
        hostLabel: mongoHost.trim(),
        databaseName: mongoDb.trim(),
        collections,
      });
    },
    onSuccess: invalidate,
  });

  const postVercelFeed = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/feeds/vercel", {
        projectId: feedProjectId,
        projectName: vercelProjectName.trim(),
        deploymentUrl: vercelUrl.trim() || null,
        environment: vercelEnv,
        readyState: vercelState,
        commitSha: vercelSha.trim() || null,
      }),
    onSuccess: invalidate,
  });

  const postRenderFeed = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/feeds/render", {
        projectId: feedProjectId,
        serviceName: renderServiceName.trim(),
        serviceUrl: renderUrl.trim() || null,
        environment: renderEnv,
        status: renderStatus,
        commitSha: renderSha.trim() || null,
      }),
    onSuccess: invalidate,
  });

  const refreshDiscovery = useMutation({
    mutationFn: () =>
      apiPost<{
        local: { linked: number } | null;
        githubToken: { imported: number } | null;
        githubApp: { imported: number } | null;
        status: { summary: { unlinkedCount: number } };
      }>("/api/v1/portfolio/discovery/refresh", {
        reconcile: true,
        linkLocalRoots: true,
      }),
    onSuccess: invalidate,
  });

  const github = connections.data?.github;
  const local = connections.data?.local;
  const githubConnected = github?.status === "CONNECTED";
  const localConnected =
    local?.status === "CONNECTED" || local?.status === "ERROR";
  const app = githubApp.data;
  const installationLabel = app
    ? t(`appState_${app.installation}` as "appState_not_configured")
    : t("appLoading");

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
          borderBottom: "1px solid rgba(26,31,42,0.12)",
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

        <Box sx={{ mt: 3 }}>
          <Typography fontWeight={650} sx={{ mb: 0.5 }}>
            {t("appTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("appHelp")}
          </Typography>
          {githubInstallStatus === "success" ? (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              {t("appInstallSuccess", { installationId: githubInstallationId ?? "—" })}
            </Alert>
          ) : githubInstallStatus === "pending" ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              {t("appInstallPending")}
            </Alert>
          ) : githubInstallStatus === "error" ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {t("appInstallError", { reason: githubInstallReason ?? "unknown" })}
            </Alert>
          ) : null}
          {githubApp.isError ? (
            <Alert severity="warning">{t("appLoadError")}</Alert>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2">
                {t("appInstallation")}: {installationLabel}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("appLastWebhook")}:{" "}
                {app?.lastWebhookAt
                  ? new Date(app.lastWebhookAt).toLocaleString()
                  : t("appNever")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("appLastSync")}:{" "}
                {app?.lastSyncAt
                  ? new Date(app.lastSyncAt).toLocaleString()
                  : t("appNever")}
              </Typography>
              {app?.installUrl ? (
                <Button
                  variant="contained"
                  color="secondary"
                  component="a"
                  href={`${API_URL}${app.installUrl}?locale=${locale}`}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("appConnectButton")}
                </Button>
              ) : app?.setupUrlNote ? (
                <Typography variant="body2" color="text.secondary">
                  {app.setupUrlNote}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("appNoSetupUrl")}
                </Typography>
              )}
              {app?.installations && app.installations.length > 0 ? (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" fontWeight={650}>
                    {t("appInstallationsTitle")}
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {app.installations.map((installation) => (
                      <Typography
                        key={installation.installationId}
                        variant="body2"
                        color="text.secondary"
                      >
                        {t("appInstallationRow", {
                          login: installation.accountLogin ?? "—",
                          selection: installation.repositorySelection ?? "—",
                          installedAt: new Date(
                            installation.installedAt,
                          ).toLocaleString(),
                        })}
                        {installation.suspendedAt ? ` · ${t("appInstallationSuspended")}` : ""}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          )}
        </Box>
      </Box>

      <Box>
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("discoveryRefresh")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("discoveryRefreshHelp")}
        </Typography>
        <Button
          variant="contained"
          onClick={() => refreshDiscovery.mutate()}
          disabled={refreshDiscovery.isPending}
          sx={{ alignSelf: "flex-start" }}
        >
          {t("discoveryRefresh")}
        </Button>
        {refreshDiscovery.isSuccess ? (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("discoveryRefreshResult", {
              localLinked: refreshDiscovery.data.local?.linked ?? 0,
              ghImported: refreshDiscovery.data.githubToken?.imported ?? 0,
              appImported: refreshDiscovery.data.githubApp?.imported ?? 0,
              unlinked: refreshDiscovery.data.status.summary.unlinkedCount,
            })}
          </Typography>
        ) : null}
        {refreshDiscovery.isError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {(refreshDiscovery.error as Error).message}
          </Alert>
        ) : null}
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

      <Box
        sx={{
          borderTop: "1px solid rgba(26,31,42,0.12)",
          pt: 3,
        }}
      >
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("dbFeedsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("dbFeedsHelp")}
        </Typography>
        <TextField
          select
          label={t("dbFeedsProject")}
          value={feedProjectId}
          onChange={(event) => setFeedProjectId(event.target.value)}
          fullWidth
          sx={{ mb: 2 }}
          helperText={t("dbFeedsProjectHelp")}
        >
          <MenuItem value="">
            <em>{t("dbFeedsPickProject")}</em>
          </MenuItem>
          {(projects.data?.items ?? []).map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </TextField>

        {feedProjectId ? (
          <Stack spacing={3}>
            {dbFeeds.data?.items && dbFeeds.data.items.length > 0 ? (
              <Alert severity="info">
                {dbFeeds.data.items
                  .map(
                    (item) =>
                      `${item.provider}: ${item.summary} (${new Date(item.observedAt).toLocaleString()})`,
                  )
                  .join(" · ")}
              </Alert>
            ) : null}

            <Box>
              <Typography fontWeight={600} sx={{ mb: 1 }}>
                {t("supabaseFeedTitle")}
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label={t("supabaseHost")}
                  value={supabaseHost}
                  onChange={(e) => setSupabaseHost(e.target.value)}
                  helperText={t("supabaseHostHelp")}
                  fullWidth
                />
                <TextField
                  label={t("supabaseTables")}
                  value={supabaseTables}
                  onChange={(e) => setSupabaseTables(e.target.value)}
                  helperText={t("supabaseTablesHelp")}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={supabaseRls}
                      onChange={(_, checked) => setSupabaseRls(checked)}
                    />
                  }
                  label={t("supabaseRls")}
                />
                <Button
                  variant="contained"
                  onClick={() => postSupabaseFeed.mutate()}
                  disabled={
                    postSupabaseFeed.isPending ||
                    supabaseHost.trim().length < 2 ||
                    supabaseTables.trim().length < 1
                  }
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("recordSupabaseFeed")}
                </Button>
                {postSupabaseFeed.isSuccess ? (
                  <Alert severity="success">{t("feedRecorded")}</Alert>
                ) : null}
                {postSupabaseFeed.isError ? (
                  <Alert severity="error">
                    {(postSupabaseFeed.error as Error).message}
                  </Alert>
                ) : null}
              </Stack>
            </Box>

            <Box>
              <Typography fontWeight={600} sx={{ mb: 1 }}>
                {t("mongoFeedTitle")}
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label={t("mongoHost")}
                  value={mongoHost}
                  onChange={(e) => setMongoHost(e.target.value)}
                  fullWidth
                />
                <TextField
                  label={t("mongoDatabase")}
                  value={mongoDb}
                  onChange={(e) => setMongoDb(e.target.value)}
                  fullWidth
                />
                <TextField
                  label={t("mongoCollections")}
                  value={mongoCollections}
                  onChange={(e) => setMongoCollections(e.target.value)}
                  helperText={t("mongoCollectionsHelp")}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={() => postMongoFeed.mutate()}
                  disabled={
                    postMongoFeed.isPending ||
                    mongoHost.trim().length < 2 ||
                    mongoDb.trim().length < 1 ||
                    mongoCollections.trim().length < 1
                  }
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("recordMongoFeed")}
                </Button>
                {postMongoFeed.isSuccess ? (
                  <Alert severity="success">{t("feedRecorded")}</Alert>
                ) : null}
                {postMongoFeed.isError ? (
                  <Alert severity="error">
                    {(postMongoFeed.error as Error).message}
                  </Alert>
                ) : null}
              </Stack>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box
        sx={{
          borderTop: "1px solid rgba(26,31,42,0.12)",
          pt: 3,
        }}
      >
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("deployFeedsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("deployFeedsHelp")}
        </Typography>
        {!feedProjectId ? (
          <Alert severity="info">{t("deployFeedsNeedProject")}</Alert>
        ) : (
          <Stack spacing={3}>
            {dbFeeds.data?.deployment && dbFeeds.data.deployment.length > 0 ? (
              <Alert severity="info">
                {dbFeeds.data.deployment
                  .map(
                    (item) =>
                      `${item.provider}: ${item.summary} (${new Date(item.observedAt).toLocaleString()})`,
                  )
                  .join(" · ")}
              </Alert>
            ) : null}

            <Box>
              <Typography fontWeight={600} sx={{ mb: 1 }}>
                {t("vercelFeedTitle")}
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label={t("vercelProjectName")}
                  value={vercelProjectName}
                  onChange={(e) => setVercelProjectName(e.target.value)}
                  fullWidth
                />
                <TextField
                  label={t("vercelDeploymentUrl")}
                  value={vercelUrl}
                  onChange={(e) => setVercelUrl(e.target.value)}
                  helperText={t("vercelDeploymentUrlHelp")}
                  fullWidth
                />
                <TextField
                  select
                  label={t("deployEnvironment")}
                  value={vercelEnv}
                  onChange={(e) =>
                    setVercelEnv(
                      e.target.value as
                        | "production"
                        | "preview"
                        | "development",
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="production">production</MenuItem>
                  <MenuItem value="preview">preview</MenuItem>
                  <MenuItem value="development">development</MenuItem>
                </TextField>
                <TextField
                  select
                  label={t("vercelReadyState")}
                  value={vercelState}
                  onChange={(e) =>
                    setVercelState(
                      e.target.value as
                        | "READY"
                        | "ERROR"
                        | "BUILDING"
                        | "QUEUED"
                        | "UNKNOWN",
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="READY">READY</MenuItem>
                  <MenuItem value="ERROR">ERROR</MenuItem>
                  <MenuItem value="BUILDING">BUILDING</MenuItem>
                  <MenuItem value="QUEUED">QUEUED</MenuItem>
                  <MenuItem value="UNKNOWN">UNKNOWN</MenuItem>
                </TextField>
                <TextField
                  label={t("deployCommitSha")}
                  value={vercelSha}
                  onChange={(e) => setVercelSha(e.target.value)}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={() => postVercelFeed.mutate()}
                  disabled={
                    postVercelFeed.isPending ||
                    vercelProjectName.trim().length < 1
                  }
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("recordVercelFeed")}
                </Button>
                {postVercelFeed.isSuccess ? (
                  <Alert severity="success">{t("deployFeedRecorded")}</Alert>
                ) : null}
                {postVercelFeed.isError ? (
                  <Alert severity="error">
                    {(postVercelFeed.error as Error).message}
                  </Alert>
                ) : null}
              </Stack>
            </Box>

            <Box>
              <Typography fontWeight={600} sx={{ mb: 1 }}>
                {t("renderFeedTitle")}
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label={t("renderServiceName")}
                  value={renderServiceName}
                  onChange={(e) => setRenderServiceName(e.target.value)}
                  fullWidth
                />
                <TextField
                  label={t("renderServiceUrl")}
                  value={renderUrl}
                  onChange={(e) => setRenderUrl(e.target.value)}
                  helperText={t("renderServiceUrlHelp")}
                  fullWidth
                />
                <TextField
                  select
                  label={t("deployEnvironment")}
                  value={renderEnv}
                  onChange={(e) =>
                    setRenderEnv(
                      e.target.value as
                        | "production"
                        | "preview"
                        | "development",
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="production">production</MenuItem>
                  <MenuItem value="preview">preview</MenuItem>
                  <MenuItem value="development">development</MenuItem>
                </TextField>
                <TextField
                  select
                  label={t("renderStatus")}
                  value={renderStatus}
                  onChange={(e) =>
                    setRenderStatus(
                      e.target.value as
                        | "live"
                        | "build_failed"
                        | "suspended"
                        | "deploying"
                        | "unknown",
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="live">live</MenuItem>
                  <MenuItem value="build_failed">build_failed</MenuItem>
                  <MenuItem value="suspended">suspended</MenuItem>
                  <MenuItem value="deploying">deploying</MenuItem>
                  <MenuItem value="unknown">unknown</MenuItem>
                </TextField>
                <TextField
                  label={t("deployCommitSha")}
                  value={renderSha}
                  onChange={(e) => setRenderSha(e.target.value)}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={() => postRenderFeed.mutate()}
                  disabled={
                    postRenderFeed.isPending ||
                    renderServiceName.trim().length < 1
                  }
                  sx={{ alignSelf: "flex-start" }}
                >
                  {t("recordRenderFeed")}
                </Button>
                {postRenderFeed.isSuccess ? (
                  <Alert severity="success">{t("deployFeedRecorded")}</Alert>
                ) : null}
                {postRenderFeed.isError ? (
                  <Alert severity="error">
                    {(postRenderFeed.error as Error).message}
                  </Alert>
                ) : null}
              </Stack>
            </Box>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
