"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import type { StudioExtensionScope } from "@/lib/studio-extension-api";
import {
  extensionMessageKey,
  useStudioExtensionAction,
  type StudioExtensionEntry,
} from "@/lib/studio-extensions";

/**
 * Renders an enabled extension's panel (ADR-026). Nothing runs until the user
 * grants at least one permission; missing permissions and failed
 * verification are shown with the way to fix them. The panel receives an
 * extension scope so the API enforces what the extension may call.
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

  // Verify prerequisites once per project the first time the panel opens.
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    const marker = `${projectId}:${manifest.id}`;
    if (entry.verification || verifiedRef.current === marker) return;
    verifiedRef.current = marker;
    action.mutate({ kind: "verify", id: manifest.id });
  }, [projectId, manifest.id, entry.verification]);

  const grantedAny = entry.granted.length > 0;
  const failed = entry.verification && !entry.verification.ok ? entry.verification : null;

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
      {failed ? (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mx: 1.5 }}
          action={
            failed.checks.some((c) => c.reason === "NO_LOCAL_FOLDER") && onLinkFolder ? (
              <Button size="small" onClick={onLinkFolder}>
                {t("panel.linkFolder")}
              </Button>
            ) : undefined
          }
        >
          {failed.checks
            .filter((c) => !c.ok && c.reason)
            .map((c) => t(`reasons.${c.reason}`))
            .join(" · ")}
        </Alert>
      ) : null}
      {children({ extensionId: manifest.id, projectId })}
    </Stack>
  );
}
