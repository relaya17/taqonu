"use client";

import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const me = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const session = await apiGet<{
        authenticated: boolean;
        user: {
          email: string;
          displayName: string | null;
          role: string;
          provider: string;
        } | null;
        role: string | null;
        capabilities: string[];
      }>("/api/v1/auth/session");
      if (!session.authenticated || !session.user) {
        throw new Error("Not signed in");
      }
      return {
        authenticated: true as const,
        user: session.user,
        role: session.role ?? session.user.role,
        capabilities: session.capabilities,
      };
    },
    retry: false,
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {me.isError || !me.data ? (
        <Alert severity="info">
          {t("signedOut")}{" "}
          <Link href="/auth/login">{t("goLogin")}</Link>
          {" · "}
          <Link href="/auth/register">{t("goRegister")}</Link>
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          <Typography>
            {t("signedInAs")}: <strong>{me.data.user.displayName ?? me.data.user.email}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {me.data.user.email} · {me.data.user.provider} · {me.data.user.role}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              onClick={() =>
                void apiPost("/api/v1/auth/logout", {}).then(() => {
                  window.location.reload();
                })
              }
            >
              {t("logout")}
            </Button>
            <Button component={Link} href="/settings/billing" variant="outlined">
              {t("openBilling")}
            </Button>
            {me.data.user.role === "admin" ? (
              <Button href="/admin" variant="contained">
                {t("openAdmin")}
              </Button>
            ) : null}
          </Stack>
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="subtitle2">{t("opsLinks")}</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={Link} href="/contract" variant="outlined" size="small">
            {t("openContract")}
          </Button>
          <Button component={Link} href="/ops/metrics" variant="outlined" size="small">
            {t("openMetrics")}
          </Button>
          <Button component={Link} href="/gates" variant="outlined" size="small">
            {t("openGates")}
          </Button>
          <Button component={Link} href="/eval" variant="outlined" size="small">
            {t("openEval")}
          </Button>
          <Button component={Link} href="/artifacts" variant="outlined" size="small">
            {t("openArtifacts")}
          </Button>
          <Button component={Link} href="/conflicts" variant="outlined" size="small">
            {t("openConflicts")}
          </Button>
        </Stack>
      </Stack>

      <Alert severity="success">{t("a11yNote")}</Alert>
    </Stack>
  );
}
