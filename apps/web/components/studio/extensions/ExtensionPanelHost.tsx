"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import type { StudioExtensionScope } from "@/lib/studio-extension-api";
import {
  HEALTH_CACHE_MS,
  extensionMessageKey,
  useStudioExtensionAction,
  type StudioExtensionEntry,
} from "@/lib/studio-extensions";

/**
 * Renders an enabled extension's panel (ADR-026). Nothing runs until the user
 * grants at least one permission (authorization). Health is informational
 * only: a DEGRADED / UNAVAILABLE result is shown with the way to fix it but
 * never hides or blocks the panel. The panel receives an extension scope so
 * the API enforces what the extension may call.
 */
export function ExtensionPanelHost({
  entry,
  projectId,
  onOpenDetails,
  onLinkFolder,
  children,
}: {
  entry: StudioExtensionEntry;
  projectId: string;
  onOpenDetails: (extensionId: string) => void;
  onLinkFolder?: () => void;
  children: (scope: StudioExtensionScope) => ReactNode;
}) {
  const t = useTranslations("studioExtensions");
  const action = useStudioExtensionAction(projectId);
  const { manifest } = entry;
  const key = extensionMessageKey(manifest.id);
  const permLabel = (p: string) => t(`perm.${extensionMessageKey(p)}.label`);

  // Check health when the panel opens if there is no result, or it is older
  // than the contract's 60 s cache.
  const checkedRef = useRef<string | null>(null);
  const healthAt = entry.health?.at ?? null;
  useEffect(() => {
    const marker = `${projectId}:${manifest.id}`;
    const fresh = healthAt !== null && Date.now() - new Date(healthAt).getTime() < HEALTH_CACHE_MS;
    if (fresh || checkedRef.current === marker) return;
    checkedRef.current = marker;
    action.mutate({ kind: "verify", id: manifest.id });
  }, [projectId, manifest.id, healthAt]);

  const grantedAny = entry.granted.length > 0;
  const health = entry.health ?? null;
  const impaired =
    health && (health.status === "DEGRADED" || health.status === "UNAVAILABLE") ? health : null;
  const impairedReasons = impaired
    ? [
        ...new Set(
          impaired.capabilities
            .filter((c) => c.status === "UNAVAILABLE" || c.status === "DEGRADED")
            .flatMap((c) => c.dependencies.filter((d) => d.status !== "OK").map((d) => d.reason ?? d.status)),
        ),
      ]
    : [];

  const grantButton = (
    <Button
      size="small"
      variant="contained"
      disabled={action.isPending}
      onClick={() =>
        action.mutate({ kind: "permissions", id: manifest.id, grant: [...entry.pendingPermissions], revoke: [] })
      }
    >
      {t("actions.grantAll")}
    </Button>
  );

  if (!grantedAny) {
    return (
      <Stack spacing={1.25} sx={{ p: 1.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 13 }}>{t("panel.needsPermissionsTitle", { name: t(`ext.${key}.name`) })}</Typography>
        <Typography sx={{ fontSize: 12.5, color: "#9AA0A8" }}>{t("installNote")}</Typography>
        <Stack component="ul" sx={{ m: 0, ps: 2.5 }}>
          {entry.pendingPermissions.map((p) => (
            <Typography component="li" key={p} sx={{ fontSize: 12.5 }}>
              {permLabel(p)}
            </Typography>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          {grantButton}
          <Button size="small" onClick={() => onOpenDetails(manifest.id)}>
            {t("actions.details")}
          </Button>
        </Stack>
        {action.isError ? <Alert severity="error">{(action.error as Error).message}</Alert> : null}
      </Stack>
    );
  }

  return (
    <Stack spacing={1}>
      {entry.pendingPermissions.length > 0 ? (
        <Alert severity="info" variant="outlined" sx={{ mx: 1.5 }} action={grantButton}>
          {t("panel.somePending", { permissions: entry.pendingPermissions.map(permLabel).join(", ") })}
        </Alert>
      ) : null}
      {impaired ? (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mx: 1.5 }}
          action={
            impairedReasons.includes("NO_LOCAL_FOLDER") && onLinkFolder ? (
              <Button size="small" onClick={onLinkFolder}>
                {t("panel.linkFolder")}
              </Button>
            ) : undefined
          }
        >
          {t("panel.health", {
            status: t(`health.${impaired.status}`),
            available: impaired.counts.healthy + impaired.counts.degraded,
            total: impaired.counts.total,
          })}
          {impairedReasons.length > 0
            ? ` — ${impairedReasons.map((r) => (t.has(`reasons.${r}`) ? t(`reasons.${r}`) : r)).join(" · ")}`
            : ""}
        </Alert>
      ) : null}
      {children({ extensionId: manifest.id, projectId })}
    </Stack>
  );
}
