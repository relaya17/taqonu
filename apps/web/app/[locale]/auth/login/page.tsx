"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Divider,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { apiGet, apiPost, downloadVerifiedSourcesPack, ADMIN_LOGIN_PATH } from "@/lib/api";
import { getSupabaseBrowserClient, oauthRedirectTo } from "@/lib/supabase";
import { DEV_CREDENTIALS, isDevLoginPrefill } from "@/lib/dev-credentials";

interface AuthProviders {
  emailPassword: boolean;
  google: boolean;
  github: boolean;
  apple: boolean;
  cloudAuth: boolean;
}

interface AuthSession {
  user: { email: string; role: string };
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.email : "");
  const [password, setPassword] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.password : "");
  const [oauthError, setOauthError] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => apiGet<AuthProviders>("/api/v1/auth/providers"),
  });

  const login = useMutation({
    mutationFn: () =>
      apiPost<AuthSession>("/api/v1/auth/login", { email, password }),
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
  });

  const startOAuth = async (provider: "google" | "github" | "apple") => {
    setOauthError(null);
    const client = getSupabaseBrowserClient();
    if (!client) {
      setOauthError(t("oauthNeedsCloud"));
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: oauthRedirectTo(locale) },
    });
    if (error) setOauthError(error.message);
  };

  const canSubmit = !login.isPending && Boolean(email) && password.length >= 8;

  return (
    <Stack
      spacing={3}
      sx={{
        maxWidth: 440,
        mx: "auto",
        width: "100%",
        minWidth: 0,
        py: { xs: 2, md: 6 },
        textAlign: "center",
        alignItems: "center",
      }}
    >
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" } }}>
          {t("loginTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
          {t("loginSubtitle")}
        </Typography>
        {isDevLoginPrefill ? (
          <Alert severity="info" sx={{ mt: 2, textAlign: "start" }}>
            מצב פיתוח — {DEV_CREDENTIALS.domain} · {DEV_CREDENTIALS.email} · {DEV_CREDENTIALS.password}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={2} sx={{ mt: 1.5, justifyContent: "center" }}>
          <Button component={Link} href="/welcome" size="small">
            {t("openLanding")}
          </Button>
          <Button component={Link} href="/plan" size="small" variant="outlined">
            {t("openPricing")}
          </Button>
        </Stack>
      </Box>

      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) login.mutate();
        }}
      >
        <Stack spacing={2}>
          <TextField
            label={t("email")}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
          />
          <TextField
            label={t("password")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
          />

          <Button type="submit" variant="contained" fullWidth disabled={!canSubmit}>
            {t("login")}
          </Button>
          <Typography variant="body2" sx={{ textAlign: "center" }}>
            <Link href="/auth/forgot">{t("forgotLink")}</Link>
          </Typography>
        </Stack>
      </Box>

      {login.isError ? (
        <Alert severity="error" role="alert">
          {(login.error as Error).message}
        </Alert>
      ) : null}

      <Divider>{t("or")}</Divider>

      <Stack spacing={1.5}>
        <Button
          variant="outlined"
          fullWidth
          disabled={!providers.data?.google}
          onClick={() => void startOAuth("google")}
        >
          {t("continueGoogle")}
        </Button>
        <Button
          variant="outlined"
          fullWidth
          disabled={!providers.data?.apple}
          onClick={() => void startOAuth("apple")}
        >
          {t("continueApple")}
        </Button>
        <Button
          variant="outlined"
          fullWidth
          disabled={!providers.data?.github}
          onClick={() => void startOAuth("github")}
        >
          {t("continueGithub")}
        </Button>
        {!providers.data?.cloudAuth ? (
          <Typography variant="body2" color="text.secondary">
            {t("oauthNeedsCloud")}
          </Typography>
        ) : null}
        {oauthError ? (
          <Alert severity="error" role="alert">
            {oauthError}
          </Alert>
        ) : null}
      </Stack>

      <Typography variant="body2">
        {t("noAccount")}{" "}
        <Link href="/auth/register">{t("registerLink")}</Link>
      </Typography>

      <Divider />

      <Alert severity="info">
        {t("verifiedPackNote")}
      </Alert>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("json")}
        >
          {t("downloadVerifiedJson")}
        </Button>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("markdown")}
        >
          {t("downloadVerifiedMd")}
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t("adminSeparateNote")}{" "}
        <Box
          component="a"
          href={ADMIN_LOGIN_PATH}
          sx={{ color: "primary.main", fontWeight: 600 }}
        >
          {ADMIN_LOGIN_PATH}
        </Box>
      </Typography>
    </Stack>
  );
}
