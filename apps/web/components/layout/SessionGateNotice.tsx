"use client";

import { CircularProgress, Box, Typography, Button, Stack } from "@mui/material";
import { useTranslations } from "next-intl";
import type { SessionGate } from "@/lib/auth-session";

interface SessionGateNoticeProps {
  gate: Exclude<SessionGate, "signed-in">;
  retrying: boolean;
  onRetry: () => void;
}

export function SessionGateNotice({ gate, retrying, onRetry }: SessionGateNoticeProps) {
  const t = useTranslations("session");

  if (gate === "checking") {
    return (
      <Box
        role="status"
        aria-label={t("checking")}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}
      >
        <Stack spacing={2} alignItems="center">
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">
            {t("checking")}
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (gate === "signed-out") {
    return (
      <Box
        role="status"
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}
      >
        <Stack spacing={2} alignItems="center">
          {retrying && <CircularProgress size={24} />}
          <Typography variant="body2" color="text.secondary">
            {t("redirecting")}
          </Typography>
        </Stack>
      </Box>
    );
  }

  // gate === "unavailable"
  return (
    <Box
      role="alert"
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, px: 3 }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 480 }}>
        <Typography variant="h6" component="p">
          {t("unavailableTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          {t("unavailableBody")}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={onRetry}
          disabled={retrying}
          startIcon={retrying ? <CircularProgress size={14} /> : undefined}
        >
          {t("retry")}
        </Button>
      </Stack>
    </Box>
  );
}
