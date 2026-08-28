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
import { apiGet, apiPost } from "@/lib/api";
import { getSupabaseBrowserClient, oauthRedirectTo } from "@/lib/supabase";
import { DEV_CREDENTIALS, isDevLoginPrefill } from "@/lib/dev-credentials";

interface AuthProviders {
  google: boolean;
  github: boolean;
  apple: boolean;
  cloudAuth: boolean;
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.email : "");
  const [password, setPassword] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.password : "");
  const [displayName, setDisplayName] = useState(
    isDevLoginPrefill ? DEV_CREDENTIALS.displayName : "",
  );
  const [oauthError, setOauthError] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => apiGet<AuthProviders>("/api/v1/auth/providers"),
  });

  const register = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/auth/register", {
        email,
        password,
        displayName: displayName || undefined,
        locale,
      }),
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

  const canSubmit =
    !register.isPending && Boolean(email) && password.length >= 8;

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
          {t("registerTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
          {t("registerSubtitle")}
        </Typography>
        {isDevLoginPrefill ? (
          <Alert severity="info" sx={{ mt: 2, textAlign: "start" }}>
            מצב פיתוח — {DEV_CREDENTIALS.domain} · {DEV_CREDENTIALS.email} · {DEV_CREDENTIALS.password}
          </Alert>
        ) : null}
      </Box>

      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) register.mutate();
        }}
      >
        <Stack spacing={2}>
          <TextField
            label={t("displayName")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
            autoComplete="name"
            inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
          />
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText={t("passwordHint")}
            fullWidth
            required
            inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
            FormHelperTextProps={{ sx: { textAlign: "start" } }}
          />

          <Button type="submit" variant="contained" fullWidth disabled={!canSubmit}>
            {t("register")}
          </Button>
        </Stack>
      </Box>

      {register.isError ? (
        <Alert severity="error" role="alert">
          {(register.error as Error).message}
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
        {oauthError ? (
          <Alert severity="error" role="alert">
            {oauthError}
          </Alert>
        ) : null}
      </Stack>

      <Typography variant="body2">
        {t("haveAccount")}{" "}
        <Link href="/auth/login">{t("loginLink")}</Link>
      </Typography>
    </Stack>
  );
}
