"use client";

import { Suspense, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiPost } from "@/lib/api";
import { WEB_POST_AUTH_PATH } from "@/lib/studio-surfaces";
import {
  auditReturnPath,
  authHrefWithNext,
  inputDirForLocale,
} from "@/lib/audit-return-path";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const params = useSearchParams();
  const next = params.get("next");
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const fieldDir = inputDirForLocale(locale);

  const reset = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/auth/password/reset", {
        token,
        newPassword: password,
      }),
    onSuccess: () => {
      window.location.href =
        auditReturnPath(locale, next) ?? `/${locale}${WEB_POST_AUTH_PATH}`;
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 440, mx: "auto", py: { xs: 2, md: 6 } }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" } }}>
          {t("resetTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("resetSubtitle")}
        </Typography>
      </Box>

      <Stack spacing={2}>
        <TextField
          label={t("resetToken")}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          fullWidth
          required
          inputProps={{ dir: fieldDir, style: { textAlign: "start" } }}
        />
        <TextField
          label={t("newPassword")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          required
          helperText={t("passwordHint")}
          inputProps={{ dir: fieldDir, style: { textAlign: "start" } }}
        />
        <Button
          variant="contained"
          disabled={reset.isPending || token.length < 20 || password.length < 8}
          onClick={() => reset.mutate()}
        >
          {t("resetSubmit")}
        </Button>
      </Stack>

      {reset.isError ? (
        <Alert severity="error">{(reset.error as Error).message}</Alert>
      ) : null}

      <Typography variant="body2">
        <Link href={authHrefWithNext("/auth/login", next)}>{t("loginLink")}</Link>
      </Typography>
    </Stack>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
