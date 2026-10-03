"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useStudioApi, type StudioExtensionScope } from "@/lib/studio-extension-api";

interface DeployFeed {
  provider: "vercel" | "render";
  projectId: string;
  observedAt: string;
  summary: string;
  environment: string;
  status: string;
  url: string | null;
  commitSha: string | null;
  hostLabel: string;
}

type Source = "vercel" | "render" | "github";
const ENVIRONMENTS = ["production", "preview", "development"] as const;
const VERCEL_STATES = ["READY", "ERROR", "BUILDING", "QUEUED", "UNKNOWN"] as const;
const RENDER_STATES = ["live", "build_failed", "suspended", "deploying", "unknown"] as const;
const CI_STATES = ["success", "failure", "unknown"] as const;

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function isHttpUrl(v: string): boolean {
  if (!v.trim()) return true;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Deployment observation feeds + manual metadata observations for Vercel,
 * Render and GitHub. These endpoints take metadata only (no tokens).
 */
export function DeployFeedsPanel({
  projectId,
  embedded = false,
  extensionScope = null,
}: {
  projectId: string;
  embedded?: boolean;
  /** Set when an official extension renders this panel (ADR-026). */
  extensionScope?: StudioExtensionScope | null;
}) {
  const t = useTranslations("deployFeeds");
  const { apiGet, apiPost } = useStudioApi(extensionScope);
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>("vercel");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [environment, setEnvironment] = useState<(typeof ENVIRONMENTS)[number]>("production");
  const [vercelState, setVercelState] = useState<(typeof VERCEL_STATES)[number]>("READY");
  const [renderState, setRenderState] = useState<(typeof RENDER_STATES)[number]>("live");
  const [commitSha, setCommitSha] = useState("");
  const [branch, setBranch] = useState("");
  const [ciStatus, setCiStatus] = useState<(typeof CI_STATES)[number]>("unknown");
  const [result, setResult] = useState<string | null>(null);

  const feeds = useQuery({
    queryKey: ["deploy-feeds", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ items: DeployFeed[]; note: string }>(
        `/api/v1/feeds/${encodeURIComponent(projectId)}/deployment`,
      ),
  });

  const submit = useMutation({
    mutationFn: async (): Promise<string> => {
      if (source === "vercel") {
        const res = await apiPost<{ evidence: unknown[] }>(
          "/api/v1/providers/vercel/observe",
          {
            projectId,
            projectName: name.trim(),
            deploymentUrl: orNull(url),
            environment,
            readyState: vercelState,
            commitSha: orNull(commitSha),
          },
        );
        return t("observed", { count: res.evidence.length });
      }
      if (source === "render") {
        const res = await apiPost<{ evidence: unknown[] }>(
          "/api/v1/providers/render/observe",
          {
            projectId,
            serviceName: name.trim(),
            serviceUrl: orNull(url),
            environment,
            status: renderState,
            commitSha: orNull(commitSha),
          },
        );
        return t("observed", { count: res.evidence.length });
      }
      const res = await apiPost<{ evidenceCount: number; syncedAt: string }>(
        "/api/v1/github/sync",
        {
          projectId,
          fullName: name.trim(),
          ...(branch.trim() ? { defaultBranch: branch.trim() } : {}),
          ...(url.trim() ? { htmlUrl: url.trim() } : {}),
          ...(commitSha.trim() ? { headSha: commitSha.trim() } : {}),
          recentCiStatus: ciStatus,
          reconcile: true,
        },
      );
      return t("synced", { count: res.evidenceCount, at: res.syncedAt });
    },
    onSuccess: (text) => {
      setResult(text);
      void queryClient.invalidateQueries({ queryKey: ["deploy-feeds", projectId] });
    },
  });

  const urlValid = isHttpUrl(url);
  const nameLabel =
    source === "vercel"
      ? t("vercelProjectName")
      : source === "render"
        ? t("renderServiceName")
        : t("githubFullName");
  const items = [...(feeds.data?.items ?? [])].sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt),
  );

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920, width: "100%" }}>
      <Box>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.4rem", sm: "1.6rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {!projectId ? (
        <Alert severity="info">{t("noProject")}</Alert>
      ) : (
        <>
          <Box>
            <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
              {t("feedTitle")}
            </Typography>
            {feeds.isError ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {(feeds.error as Error).message}
              </Alert>
            ) : items.length === 0 ? (
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {feeds.isPending ? t("loading") : t("feedEmpty")}
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {items.map((f) => (
                  <Box
                    key={`${f.provider}-${f.observedAt}-${f.hostLabel}`}
                    sx={{ py: 1, borderBottom: "1px solid", borderColor: "divider" }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={f.provider} />
                      <Chip size="small" variant="outlined" label={f.environment} />
                      <Chip size="small" variant="outlined" label={f.status} />
                      <Typography variant="body2" fontWeight={600}>
                        {f.hostLabel}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {f.summary}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ wordBreak: "break-all" }}>
                      {f.observedAt}
                      {f.commitSha ? ` · ${f.commitSha.slice(0, 12)}` : ""}
                      {f.url ? ` · ${f.url}` : ""}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
              {t("observeTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("observeHelp")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              onChange={(_e, v: Source | null) => {
                if (v) {
                  setSource(v);
                  setResult(null);
                  submit.reset();
                }
              }}
              aria-label={t("sourceLabel")}
              sx={{ mt: 1.5 }}
            >
              <ToggleButton value="vercel">{t("vercel")}</ToggleButton>
              <ToggleButton value="render">{t("render")}</ToggleButton>
              <ToggleButton value="github">{t("github")}</ToggleButton>
            </ToggleButtonGroup>

            <Stack spacing={1.5} sx={{ mt: 2, maxWidth: 560 }}>
              <TextField
                size="small"
                required
                label={nameLabel}
                value={name}
                onChange={(e) => setName(e.target.value)}
                inputProps={{ maxLength: 200 }}
                {...(source === "github" ? { helperText: t("githubFullNameHelp") } : {})}
              />
              <TextField
                size="small"
                label={source === "github" ? t("repoUrl") : t("deploymentUrl")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                error={!urlValid}
                {...(!urlValid ? { helperText: t("invalidUrl") } : {})}
              />
              {source !== "github" ? (
                <TextField
                  select
                  size="small"
                  label={t("environment")}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as (typeof ENVIRONMENTS)[number])}
                >
                  {ENVIRONMENTS.map((env) => (
                    <MenuItem key={env} value={env}>
                      {t(`env.${env}`)}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  size="small"
                  label={t("defaultBranch")}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  inputProps={{ maxLength: 200 }}
                />
              )}
              {source === "vercel" ? (
                <TextField
                  select
                  size="small"
                  label={t("status")}
                  value={vercelState}
                  onChange={(e) => setVercelState(e.target.value as (typeof VERCEL_STATES)[number])}
                >
                  {VERCEL_STATES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextField>
              ) : source === "render" ? (
                <TextField
                  select
                  size="small"
                  label={t("status")}
                  value={renderState}
                  onChange={(e) => setRenderState(e.target.value as (typeof RENDER_STATES)[number])}
                >
                  {RENDER_STATES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  select
                  size="small"
                  label={t("ciStatus")}
                  value={ciStatus}
                  onChange={(e) => setCiStatus(e.target.value as (typeof CI_STATES)[number])}
                >
                  {CI_STATES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {t(`ci.${s}`)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                size="small"
                label={t("commitSha")}
                value={commitSha}
                onChange={(e) => setCommitSha(e.target.value)}
                inputProps={{ maxLength: source === "github" ? 64 : 80 }}
              />
              <Button
                variant="contained"
                sx={{ alignSelf: "flex-start" }}
                disabled={!name.trim() || !urlValid || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending
                  ? t("submitting")
                  : source === "github"
                    ? t("sync")
                    : t("observe")}
              </Button>
              {submit.isError ? (
                <Alert severity="error">{(submit.error as Error).message}</Alert>
              ) : null}
              {result ? <Alert severity="success">{result}</Alert> : null}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}
