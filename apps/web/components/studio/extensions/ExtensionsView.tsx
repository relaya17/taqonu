"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  List,
  ListItem,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { ExtensionIcon } from "@/components/studio/extensions/ExtensionIcon";
import {
  extensionMessageKey,
  useStudioExtensions,
  type StudioExtensionEntry,
} from "@/lib/studio-extensions";

type Filter = "all" | "installed" | "builtin" | "official";

const INK = "#D4D6DB";
const MUTED = "#9AA0A8";

export function extensionStateLabel(
  entry: StudioExtensionEntry,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "ok" | "off" | "warn" } {
  if (!entry.compatible) return { label: t("state.incompatible"), tone: "warn" };
  if (!entry.installed) return { label: t("state.notInstalled"), tone: "off" };
  if (entry.enabled) return { label: t("state.enabled"), tone: "ok" };
  return { label: t("state.installedOff"), tone: "off" };
}

export function extensionCheckLabel(
  entry: StudioExtensionEntry,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "ok" | "off" | "warn" } | null {
  if (!entry.installed) return null;
  if (entry.pendingPermissions.length > 0) return { label: t("check.pending"), tone: "warn" };
  if (!entry.verification) return { label: t("check.unverified"), tone: "warn" };
  return entry.verification.ok
    ? { label: t("check.verified"), tone: "ok" }
    : { label: t("check.failed"), tone: "warn" };
}

const TONE: Record<"ok" | "off" | "warn", { bg: string; fg: string }> = {
  ok: { bg: "#1F3A2A", fg: "#9FE0B1" },
  off: { bg: "#2A2D33", fg: "#C3C7CE" },
  warn: { bg: "#3A321C", fg: "#EBCB7A" },
};

/**
 * Side-bar view of the official extension catalog (ADR-026): search, filters,
 * installed and available sections. Selecting one opens its details in the
 * editor area.
 */
export function ExtensionsView({
  projectId,
  selectedId,
  onSelect,
}: {
  projectId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("studioExtensions");
  const query = useStudioExtensions(projectId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const entries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data?.extensions ?? []).filter((entry) => {
      const key = extensionMessageKey(entry.manifest.id);
      const text = `${t(`ext.${key}.name`)} ${t(`ext.${key}.description`)} ${entry.manifest.name}`.toLowerCase();
      if (needle && !text.includes(needle)) return false;
      if (filter === "installed") return entry.installed;
      if (filter === "builtin") return entry.manifest.kind === "builtin";
      if (filter === "official") return entry.manifest.kind === "official";
      return true;
    });
  }, [query.data, search, filter, t]);

  const installed = entries.filter((e) => e.installed);
  const available = entries.filter((e) => !e.installed);

  const row = (entry: StudioExtensionEntry) => {
    const key = extensionMessageKey(entry.manifest.id);
    const state = extensionStateLabel(entry, t);
    const check = extensionCheckLabel(entry, t);
    const selected = selectedId === entry.manifest.id;
    return (
      <ListItem key={entry.manifest.id} disablePadding>
      <ListItemButton
        selected={selected}
        onClick={() => onSelect(entry.manifest.id)}
        aria-label={t(`ext.${key}.name`)}
        sx={{
          alignItems: "flex-start",
          gap: 1.25,
          py: 1,
          borderInlineStart: selected ? "2px solid #4C8DFF" : "2px solid transparent",
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            flexShrink: 0,
            borderRadius: 1,
            bgcolor: "#23262D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: INK,
          }}
          aria-hidden
        >
          <ExtensionIcon icon={entry.manifest.contributes.activity?.icon ?? "extension"} fontSize="small" />
        </Box>
        <Stack spacing={0.4} sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1}>
            <Typography sx={{ fontWeight: 600, fontSize: 13, color: "#EEF0F3" }} noWrap>
              {t(`ext.${key}.name`)}
            </Typography>
            <Typography sx={{ fontSize: 11, color: MUTED }} dir="ltr">
              {entry.installedVersion ?? entry.manifest.version}
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 12, color: MUTED }}>{t(`ext.${key}.description`)}</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={t(`kind.${entry.manifest.kind}`)} sx={{ height: 20, fontSize: 11 }} />
            <Chip
              size="small"
              label={state.label}
              sx={{ height: 20, fontSize: 11, bgcolor: TONE[state.tone].bg, color: TONE[state.tone].fg }}
            />
            {check ? (
              <Chip
                size="small"
                label={check.label}
                sx={{ height: 20, fontSize: 11, bgcolor: TONE[check.tone].bg, color: TONE[check.tone].fg }}
              />
            ) : null}
            {entry.updateAvailable ? (
              <Chip size="small" label={t("state.updateAvailable")} sx={{ height: 20, fontSize: 11 }} />
            ) : null}
          </Stack>
        </Stack>
      </ListItemButton>
      </ListItem>
    );
  };

  return (
    <Stack spacing={1} sx={{ pb: 2 }}>
      <Box sx={{ px: 1.5 }}>
        <TextField
          size="small"
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          inputProps={{ "aria-label": t("search") }}
        />
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }} role="group" aria-label={t("filtersLabel")}>
          {(["all", "installed", "builtin", "official"] as const).map((id) => (
            <Chip
              key={id}
              size="small"
              label={t(`filters.${id}`)}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              variant={filter === id ? "filled" : "outlined"}
              color={filter === id ? "primary" : "default"}
            />
          ))}
          <Chip
            size="small"
            label={t("filters.thirdParty")}
            variant="outlined"
            aria-disabled
            sx={{ color: "#B9BDC4", borderStyle: "dashed" }}
          />
        </Stack>
      </Box>

      {query.isError ? (
        <Alert severity="error" sx={{ mx: 1.5 }}>
          {(query.error as Error).message}
        </Alert>
      ) : null}
      {query.isSuccess && entries.length === 0 ? (
        <Typography variant="body2" sx={{ px: 1.5, color: MUTED }}>
          {t("empty")}
        </Typography>
      ) : null}

      {installed.length > 0 ? (
        <Box component="section" aria-label={t("sections.installed")}>
          <Typography component="h2" sx={{ px: 1.75, py: 0.5, fontSize: 11, fontWeight: 700, color: MUTED }}>
            {t("sections.installed")}
          </Typography>
          <List dense disablePadding>
            {installed.map(row)}
          </List>
        </Box>
      ) : null}
      {available.length > 0 ? (
        <Box component="section" aria-label={t("sections.available")}>
          <Typography component="h2" sx={{ px: 1.75, py: 0.5, fontSize: 11, fontWeight: 700, color: MUTED }}>
            {t("sections.available")}
          </Typography>
          <List dense disablePadding>
            {available.map(row)}
          </List>
        </Box>
      ) : null}
      <Typography variant="caption" sx={{ px: 1.75, color: MUTED }}>
        {t("thirdPartyNote")}
      </Typography>
    </Stack>
  );
}
