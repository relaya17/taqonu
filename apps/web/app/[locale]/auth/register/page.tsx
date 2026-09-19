"use client";

import { Suspense, useState } from "react";
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
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";
import { getSupabaseBrowserClient, oauthRedirectTo } from "@/lib/supabase";
import { DEV_CREDENTIALS, isDevLoginPrefill } from "@/lib/dev-credentials";
import { WEB_POST_AUTH_PATH } from "@/lib/studio-surfaces";
import {
  auditReturnPath,
  authHrefWithNext,
  inputDirForLocale,
} from "@/lib/audit-return-path";

interface AuthProviders {
  google: boolean;
  github: boolean;
  apple: boolean;
  cloudAuth: boolean;
}

function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.email : "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(
    isDevLoginPrefill ? DEV_CREDENTIALS.displayName : "",
  );
  const [oauthError, setOauthError] = useState<string | null>(null);
  const fieldDir = inputDirForLocale(locale);

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
      // Hard navigation, not router.push()+router.refresh() -- see the
      // identical fix and explanation in auth/login/page.tsx.
      // Studio is the signed-in working entry. Dashboard stays at `/${locale}`.
      window.location.href =
        auditReturnPath(locale, next) ?? `/${locale}${WEB_POST_AUTH_PATH}`;
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
      options: { redirectTo: oauthRedirectTo(locale, next) },
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
            מצב פיתוח — {DEV_CREDENTIALS.domain} · {DEV_CREDENTIALS.email}
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
            inputProps={{ dir: fieldDir, style: { textAlign: "start" } }}
          />
          <TextField
            label={t("email")}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            inputProps={{ dir: fieldDir, style: { textAlign: "start" } }}
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
            inputProps={{ dir: fieldDir, style: { textAlign: "start" } }}
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
        <Link href={authHrefWithNext("/auth/login", next)}>{t("loginLink")}</Link>
      </Typography>
    </Stack>
  );
}

export default function RegisterPageGate() {
  return (
    <Suspense fallback={null}>
      <RegisterPage />
    </Suspense>
  );
}
