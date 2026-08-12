"use client";

import { useEffect, useState } from "react";
import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { apiPost } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getSupabaseBrowserClient();
        if (!client) {
          throw new Error(t("oauthNeedsCloud"));
        }
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const session = data.session;
        if (!session?.user?.email) {
          throw new Error(t("oauthFailed"));
        }
        const provider =
          session.user.app_metadata?.provider === "github" ? "github" : "google";
        await apiPost("/api/v1/auth/oauth/sync", {
          id: session.user.id,
          email: session.user.email,
          displayName:
            session.user.user_metadata?.full_name ??
            session.user.user_metadata?.name ??
            null,
          avatarUrl: session.user.user_metadata?.avatar_url ?? null,
          provider,
          locale,
          // Forward the Supabase session the browser already holds so the
          // API can route cloud writes through an RLS-scoped client instead
          // of the service-role bypass (see apps/api/.../auth.ts oauth/sync).
          accessToken: session.access_token,
          refreshToken: session.refresh_token ?? null,
          expiresAt: session.expires_at ? session.expires_at * 1000 : null,
        });
        if (!cancelled) {
          router.replace("/");
          router.refresh();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("oauthFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, router, t]);

  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 8 }}>
      {!error ? (
        <>
          <CircularProgress aria-label={t("oauthWorking")} />
          <Typography>{t("oauthWorking")}</Typography>
        </>
      ) : (
        <Alert severity="error">{error}</Alert>
      )}
    </Stack>
  );
}
