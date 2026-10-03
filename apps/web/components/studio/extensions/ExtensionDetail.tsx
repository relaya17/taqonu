"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import { useFormatter, useTranslations } from "next-intl";
import { ExtensionIcon } from "@/components/studio/extensions/ExtensionIcon";
import {
  extensionCheckLabel,
  extensionStateLabel,
} from "@/components/studio/extensions/ExtensionsView";
import {
  extensionMessageKey,
  useStudioExtensionAction,
  useStudioExtensions,
} from "@/lib/studio-extensions";

const MUTED = "#9AA0A8";
const CARD = { border: "1px solid #2C3038", borderRadius: 2, p: 2 } as const;

/**
 * One extension's page in the editor area (ADR-026): state, lifecycle actions,
 * permissions granted one by one, the capabilities it really connects, what it
 * adds to Studio, and the verification check.
 */
export function ExtensionDetail({
  projectId,
  extensionId,
  onOpenPanel,
}: {
  projectId: string | null;
  extensionId: string;
  onOpenPanel?: (extensionId: string) => void;
}) {
  const t = useTranslations("studioExtensions");
  const format = useFormatter();
  const query = useStudioExtensions(projectId);
  const action = useStudioExtensionAction(projectId);
  const entry = query.data?.extensions.find((e) => e.manifest.id === extensionId) ?? null;

  if (query.isError) {
    return <Alert severity="error" sx={{ m: 2 }}>{(query.error as Error).message}</Alert>;
  }
  if (!entry) {
    return (
      <Typography sx={{ p: 3, color: MUTED }}>{query.isPending ? t("loading") : t("notFound")}</Typography>
    );
  }

  const { manifest } = entry;
  const key = extensionMessageKey(manifest.id);
  const name = t(`ext.${key}.name`);
  const state = extensionStateLabel(entry, t);
  const check = extensionCheckLabel(entry, t);
  const busy = action.isPending;
  const permLabel = (p: string) => t(`perm.${extensionMessageKey(p)}.label`);

  return (
    <Stack spacing={2} sx={{ p: { xs: 2, md: 3 }, maxWidth: 980 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "flex-start" }}>
        <Box
          aria-hidden
          sx={{
            width: 64,
            height: 64,
            borderRadius: 2,
            bgcolor: "#23262D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ExtensionIcon icon={manifest.contributes.activity?.icon ?? "extension"} sx={{ fontSize: 34 }} />
        </Box>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 22, fontWeight: 700, color: "#EEF0F3" }}>
            {name}
          </Typography>
          <Typography sx={{ color: MUTED, fontSize: 13 }}>{t(`ext.${key}.description`)}</Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ fontSize: 13, color: MUTED }}>
            <span>ArletOS</span>
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: "#9FE0B1" }}>
              <VerifiedOutlinedIcon sx={{ fontSize: 16 }} aria-hidden />
              <span>{t("publisherVerified")}</span>
            </Stack>
            <span>·</span>
            <span>{t("version", { version: entry.installedVersion ?? manifest.version })}</span>
            <span>·</span>
            <span>{t("requiresStudio", { version: manifest.studio })}</span>
            <span>·</span>
            <span>{t(`kind.${manifest.kind}`)}</span>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={state.label} />
            {check ? <Chip size="small" label={check.label} /> : null}
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {!entry.installed && manifest.kind === "official" ? (
            <Button
              variant="contained"
              disabled={busy || !entry.compatible}
              onClick={() => action.mutate({ kind: "install", id: manifest.id })}
            >
              {t("actions.install")}
            </Button>
          ) : null}
          {entry.updateAvailable ? (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => action.mutate({ kind: "update", id: manifest.id })}
            >
              {t("actions.update", { version: manifest.version })}
            </Button>
          ) : null}
          {entry.installed && projectId && !entry.enabled ? (
            <Button
              variant={entry.updateAvailable ? "outlined" : "contained"}
              disabled={busy || !entry.compatible}
              onClick={() => action.mutate({ kind: "enable", id: manifest.id })}
            >
              {t("actions.enable")}
            </Button>
          ) : null}
          {entry.installed && projectId && entry.enabled ? (
            <>
              {manifest.contributes.activity && onOpenPanel ? (
                <Button variant="outlined" onClick={() => onOpenPanel(manifest.id)}>
                  {t("actions.open")}
                </Button>
              ) : null}
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => action.mutate({ kind: "disable", id: manifest.id })}
              >
                {t("actions.disable")}
              </Button>
            </>
          ) : null}
          {entry.installed && manifest.kind === "official" ? (
            <Button
              variant="outlined"
              color="warning"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("uninstallConfirm", { name }))) {
                  action.mutate({ kind: "uninstall", id: manifest.id });
                }
              }}
            >
              {t("actions.uninstall")}
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {manifest.kind === "builtin" ? (
        <Alert severity="info" variant="outlined">{t("builtinNote")}</Alert>
      ) : null}
      {!projectId && entry.installed ? (
        <Alert severity="info" variant="outlined">{t("noProject")}</Alert>
      ) : null}
      {!entry.compatible ? <Alert severity="warning">{t("incompatibleNote")}</Alert> : null}
      {action.isError ? <Alert severity="error">{(action.error as Error).message}</Alert> : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <Box component="section" aria-label={t("detail.permissions")} sx={CARD}>
          <Typography component="h3" sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>
            {t("detail.permissions")}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 1 }}>{t("installNote")}</Typography>
          <Stack divider={<Box sx={{ borderTop: "1px solid #23262D" }} />}>
            {manifest.permissions.map((permission) => {
              const granted = entry.granted.includes(permission);
              return (
                <Stack key={permission} direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13 }}>{permLabel(permission)}</Typography>
                    <Typography sx={{ fontSize: 12, color: MUTED }}>
                      {t(`perm.${extensionMessageKey(permission)}.description`)}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: granted ? "#9FE0B1" : "#EBCB7A", whiteSpace: "nowrap" }}>
                    {granted ? t("permission.granted") : t("permission.pending")}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy || !entry.installed}
                    aria-label={`${granted ? t("actions.revoke") : t("actions.grant")}: ${permLabel(permission)}`}
                    onClick={() =>
                      action.mutate({
                        kind: "permissions",
                        id: manifest.id,
                        grant: granted ? [] : [permission],
                        revoke: granted ? [permission] : [],
                      })
                    }
                  >
                    {granted ? t("actions.revoke") : t("actions.grant")}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
          {entry.installed && entry.pendingPermissions.length > 1 ? (
            <Button
              size="small"
              sx={{ mt: 1 }}
              disabled={busy}
              onClick={() =>
                action.mutate({ kind: "permissions", id: manifest.id, grant: [...entry.pendingPermissions], revoke: [] })
              }
            >
              {t("actions.grantAll")}
            </Button>
          ) : null}
        </Box>

        <Box component="section" aria-label={t("detail.capabilities")} sx={CARD}>
          <Typography component="h3" sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>
            {t("detail.capabilities")}
          </Typography>
          <Stack divider={<Box sx={{ borderTop: "1px solid #23262D" }} />}>
            {manifest.capabilities.map((capability) => {
              const ready = !capability.permission || entry.granted.includes(capability.permission);
              return (
                <Stack key={capability.id} direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.75 }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13 }}>{t(`cap.${extensionMessageKey(capability.id)}`)}</Typography>
                    <Typography
                      sx={{ fontSize: 11.5, color: MUTED, overflowWrap: "anywhere", textAlign: "start" }}
                      dir="ltr"
                      component="bdi"
                    >
                      {capability.source}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: ready ? "#9FE0B1" : "#EBCB7A", whiteSpace: "nowrap" }}>
                    {ready
                      ? t("capability.ready")
                      : t("capability.needs", { permission: permLabel(capability.permission ?? "") })}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Box>

        <Box component="section" aria-label={t("detail.contributes")} sx={CARD}>
          <Typography component="h3" sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>
            {t("detail.contributes")}
          </Typography>
          {manifest.contributes.activity ? (
            <Typography sx={{ fontSize: 13 }}>• {t("contributesActivity", { name })}</Typography>
          ) : null}
          {manifest.contributes.commands.includes("open") ? (
            <Typography sx={{ fontSize: 13 }}>• {t("contributesCommand", { name })}</Typography>
          ) : null}
        </Box>

        <Box component="section" aria-label={t("detail.verification")} sx={CARD}>
          <Typography component="h3" sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>
            {t("detail.verification")}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 1 }}>{t("verificationHelp")}</Typography>
          {entry.verification ? (
            <Stack spacing={0.5} sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: 13 }}>
                {t("verifiedAt", { date: format.dateTime(new Date(entry.verification.at), { dateStyle: "medium", timeStyle: "short" }) })}
              </Typography>
              {entry.verification.checks.map((c) => (
                <Typography key={c.id} sx={{ fontSize: 13, color: c.ok ? "#9FE0B1" : "#EBCB7A" }}>
                  {c.ok ? "✓" : "✗"} {t(`checks.${extensionMessageKey(c.id)}`)}
                  {c.reason ? ` — ${t(`reasons.${c.reason}`)}` : ""}
                </Typography>
              ))}
              {entry.verification.checks.length === 0 ? (
                <Typography sx={{ fontSize: 13, color: "#9FE0B1" }}>✓ {t("checks.none")}</Typography>
              ) : null}
            </Stack>
          ) : (
            <Typography sx={{ fontSize: 13, color: MUTED, mb: 1 }}>{t("verifyNever")}</Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !projectId || !entry.installed}
            onClick={() => action.mutate({ kind: "verify", id: manifest.id })}
          >
            {t("actions.verify")}
          </Button>
        </Box>
      </Box>
    </Stack>
  );
}
