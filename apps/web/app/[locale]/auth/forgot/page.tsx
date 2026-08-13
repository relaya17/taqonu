"use client";

import { useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiPost } from "@/lib/api";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const forgot = useMutation({
    mutationFn: () =>
      apiPost<{
        ok: boolean;
        message: string;
        resetToken?: string;
        expiresAt?: string;
      }>("/api/v1/auth/password/forgot", { email }),
    onSuccess: (data) => {
      setToken(data.resetToken ?? null);
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 440, mx: "auto", py: { xs: 2, md: 6 } }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" } }}>
          {t("forgotTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("forgotSubtitle")}
        </Typography>
      </Box>

      <Stack spacing={2}>
        <TextField
          label={t("email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          required
        />
        <Button
          variant="contained"
          disabled={forgot.isPending || !email.includes("@")}
          onClick={() => forgot.mutate()}
        >
          {t("forgotSubmit")}
        </Button>
      </Stack>

      {forgot.isSuccess ? (
        <Alert severity="success">
          {t("forgotSent")}
          {token ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2">{t("forgotDevToken")}</Typography>
              <Typography
                component="code"
                sx={{ display: "block", mt: 0.5, wordBreak: "break-all" }}
              >
                {token}
              </Typography>
              <Button
                component={Link}
                href={`/auth/reset?token=${encodeURIComponent(token)}`}
                sx={{ mt: 1 }}
                size="small"
              >
                {t("forgotContinueReset")}
              </Button>
            </Box>
          ) : null}
        </Alert>
      ) : null}
      {forgot.isError ? (
        <Alert severity="error">{(forgot.error as Error).message}</Alert>
      ) : null}

      <Typography variant="body2">
        <Link href="/auth/login">{t("loginLink")}</Link>
      </Typography>
    </Stack>
  );
}
