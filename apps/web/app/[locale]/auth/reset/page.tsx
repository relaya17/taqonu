"use client";

import { Suspense, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { apiPost } from "@/lib/api";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/auth/password/reset", {
        token,
        newPassword: password,
      }),
    onSuccess: () => {
      router.push("/");
      router.refresh();
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
        />
        <TextField
          label={t("newPassword")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          required
          helperText={t("passwordHint")}
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
        <Link href="/auth/login">{t("loginLink")}</Link>
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
