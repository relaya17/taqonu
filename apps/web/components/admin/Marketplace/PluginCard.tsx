"use client";

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import type { PluginManifest } from "./types";
import { STATUS_LABELS, legalActions, statusColor } from "./types";

interface PluginCardProps {
  plugin: PluginManifest;
  busy?: boolean;
  onOpenDetail: (plugin: PluginManifest) => void;
  onApprove: (plugin: PluginManifest) => void;
  onReject: (plugin: PluginManifest) => void;
  onEnable: (plugin: PluginManifest) => void;
  onDisable: (plugin: PluginManifest) => void;
  onUninstall: (plugin: PluginManifest) => void;
}

/**
 * One registered plugin's summary row. Only offers the actions that are
 * legal from the plugin's CURRENT status (mirrors the exact state machine
 * `plugin-lifecycle.ts` enforces server-side) — never renders a button that
 * would always come back as a 403.
 */
export function PluginCard({
  plugin,
  busy = false,
  onOpenDetail,
  onApprove,
  onReject,
  onEnable,
  onDisable,
  onUninstall,
}: PluginCardProps) {
  const actions = legalActions(plugin.status);

  return (
    <Box
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={1.5}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography fontWeight={700}>{plugin.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {plugin.id} · v{plugin.version}
            </Typography>
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {plugin.description}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={STATUS_LABELS[plugin.status]} color={statusColor(plugin.status)} />
            <Chip size="small" variant="outlined" label={`סיכון: ${plugin.riskLevel}`} />
            <Chip size="small" variant="outlined" label={`יוצר: ${plugin.author}`} />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
          <Button size="small" variant="outlined" onClick={() => onOpenDetail(plugin)}>
            פרטים
          </Button>
          {actions.approve ? (
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={busy}
              onClick={() => onApprove(plugin)}
            >
              אישור
            </Button>
          ) : null}
          {actions.reject ? (
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => onReject(plugin)}
            >
              דחייה
            </Button>
          ) : null}
          {actions.enable ? (
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={busy}
              onClick={() => onEnable(plugin)}
            >
              הפעלה
            </Button>
          ) : null}
          {actions.disable ? (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              disabled={busy}
              onClick={() => onDisable(plugin)}
            >
              השבתה
            </Button>
          ) : null}
          {actions.uninstall ? (
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => onUninstall(plugin)}
            >
              הסרה
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}
