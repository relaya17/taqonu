"use client";

import { Alert, Box, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { asMuiHref, studioCheckHref, studioProjectHref } from "@/lib/studio-surfaces";

interface PatchItem {
  readonly id: string;
  readonly status: string;
}
interface PatchesResponse {
  readonly items: readonly PatchItem[];
}

interface ExtensionHealthSummary {
  readonly status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CHECKED";
}
interface ExtensionEntry {
  readonly installed: boolean;
  readonly enabled?: boolean;
  readonly pendingPermissions: readonly string[];
  readonly health?: ExtensionHealthSummary | null;
}
interface ExtensionsResponse {
  readonly extensions: readonly ExtensionEntry[];
}

interface SentinelResponse {
  readonly findings?: ReadonlyArray<{ readonly id: string }>;
}

/** Awaiting human attention — not yet applied or rejected. */
const PENDING_PATCH_STATUSES = new Set(["PROPOSED", "EVALUATED", "AWAITING_APPROVAL"]);

/**
 * "What is happening in my engineering environment right now?" — surfaces
 * existing Studio state (patches, extensions, security) on the Dashboard
 * without duplicating those surfaces; every chip links into Studio.
 */
export function EngineeringStatusCard({ projectId }: { projectId: string }) {
  const t = useTranslations("dashboard.engineering");

  const patches = useQuery({
    queryKey: ["dashboard-patches", projectId],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      apiGet<PatchesResponse>(
        `/api/v1/code/patches?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const extensions = useQuery({
    queryKey: ["dashboard-extensions", projectId],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      apiGet<ExtensionsResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/extensions`,
      ),
  });

  const sentinel = useQuery({
    queryKey: ["dashboard-sentinel", projectId],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      apiGet<SentinelResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sentinel`,
      ),
  });

  if (!projectId) return null;

  const loading = patches.isLoading || extensions.isLoading || sentinel.isLoading;
  const pendingPatches = (patches.data?.items ?? []).filter((p) =>
    PENDING_PATCH_STATUSES.has(p.status),
  );
  const enabledExtensions = (extensions.data?.extensions ?? []).filter(
    (e) => e.installed && e.enabled,
  );
  const degradedExtensions = enabledExtensions.filter(
    (e) => e.health?.status === "DEGRADED" || e.health?.status === "UNAVAILABLE",
  );
  const pendingGrantExtensions = enabledExtensions.filter(
    (e) => e.pendingPermissions.length > 0,
  );
  const findingCount = sentinel.data?.findings?.length ?? 0;
  const anyError = patches.isError || extensions.isError || sentinel.isError;

  return (
    <Box
      component="section"
      aria-labelledby="engineering-status-title"
      sx={{
        width: "100%",
        textAlign: "start",
        p: 2.5,
        borderRadius: 2,
        border: "1px solid rgba(26,31,42,0.14)",
      }}
    >
      <Typography id="engineering-status-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
        {t("title")}
      </Typography>
      {loading ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Skeleton variant="rounded" width={160} height={32} />
          <Skeleton variant="rounded" width={160} height={32} />
          <Skeleton variant="rounded" width={160} height={32} />
          <Skeleton variant="rounded" width={160} height={32} />
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            component={Link}
            href={asMuiHref(studioProjectHref(projectId))}
            clickable
            color={pendingPatches.length > 0 ? "warning" : "default"}
            label={t("pendingPatches", { count: pendingPatches.length })}
          />
          <Chip
            component={Link}
            href={asMuiHref(studioProjectHref(projectId))}
            clickable
            color={degradedExtensions.length > 0 ? "warning" : "default"}
            label={t("extensionsHealth", {
              ok: enabledExtensions.length - degradedExtensions.length,
              total: enabledExtensions.length,
            })}
          />
          <Chip
            component={Link}
            href={asMuiHref(studioProjectHref(projectId))}
            clickable
            color={pendingGrantExtensions.length > 0 ? "info" : "default"}
            label={t("pendingPermissions", { count: pendingGrantExtensions.length })}
          />
          <Chip
            component={Link}
            href={asMuiHref(studioCheckHref("sentinel", projectId))}
            clickable
            color={findingCount > 0 ? "error" : "default"}
            label={t("openFindings", { count: findingCount })}
          />
        </Stack>
      )}
      {anyError ? (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {t("partialData")}
        </Alert>
      ) : null}
    </Box>
  );
}
