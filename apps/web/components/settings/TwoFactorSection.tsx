"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/api";
import { AUTH_SESSION_QUERY_KEY, fetchAuthSession } from "@/lib/auth-session";

interface MfaUser {
  id: string;
  email: string;
  mfaEnabled?: boolean;
}

/** Response of POST /api/v1/auth/mfa/setup (mfaSetupResponseSchema). */
interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

type Step = "idle" | "setup" | "codes" | "disable";

/**
 * TOTP two-factor authentication for the signed-in user.
 * Secrets and backup codes live only in component memory and are dropped as
 * soon as the flow ends — never logged, never written to storage.
 */
export function TwoFactorSection() {
  const t = useTranslations("twoFactor");
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("idle");
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const session = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => fetchAuthSession<MfaUser>(),
    retry: false,
  });

  const enabled = Boolean(session.data?.user.mfaEnabled);

  const resetFlow = () => {
    setStep("idle");
    setSetupData(null);
    setCode("");
    setCopied(null);
  };

  const setup = useMutation({
    mutationFn: () => apiPost<MfaSetupResponse>("/api/v1/auth/mfa/setup", {}),
    onSuccess: (data) => {
      setNotice(null);
      setSetupData(data);
      setCode("");
      setStep("setup");
    },
  });

  const confirm = useMutation({
    mutationFn: (value: string) =>
      apiPost<{ ok: boolean }>("/api/v1/auth/mfa/confirm", { code: value }),
    onSuccess: () => {
      setCode("");
      setStep("codes");
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
    },
  });

  const disable = useMutation({
    mutationFn: (value: string) =>
      apiPost<{ ok: boolean }>("/api/v1/auth/mfa/disable", { code: value }),
    onSuccess: () => {
      resetFlow();
      setNotice(t("disabledNotice"));
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
    },
  });

  const copy = async (text: string, which: "secret" | "codes") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied(null);
    }
  };

  if (!session.data) return null;

  const totpCode = code.replace(/\s+/g, "");
  const totpValid = /^\d{6}$/.test(totpCode);
  const disableCode = code.trim();
  const disableValid = disableCode.length >= 6 && disableCode.length <= 24;

  return (
    <Box component="section" aria-labelledby="two-factor-title">
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <Typography id="two-factor-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("title")}
        </Typography>
        <Chip
          size="small"
          label={enabled ? t("statusOn") : t("statusOff")}
          color={enabled ? "success" : "default"}
          variant={enabled ? "filled" : "outlined"}
        />
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("help")}
      </Typography>

      {notice ? (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      ) : null}

      {step === "idle" && !enabled ? (
        <Stack spacing={1.5} alignItems="flex-start">
          <Button
            variant="contained"
            onClick={() => setup.mutate()}
            disabled={setup.isPending}
          >
            {setup.isPending ? t("starting") : t("turnOn")}
          </Button>
          {setup.isError ? (
            <Alert severity="error">{(setup.error as Error).message || t("error")}</Alert>
          ) : null}
        </Stack>
      ) : null}

      {step === "setup" && setupData ? (
        <Stack spacing={2}>
          <Typography variant="subtitle1" component="h3" fontWeight={700}>
            {t("step1Title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("step1Help")}
          </Typography>
          <Box>
            <Button
              component="a"
              href={setupData.otpauthUrl}
              variant="outlined"
              size="small"
            >
              {t("openInApp")}
            </Button>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              {t("secretLabel")}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box
                component="code"
                dir="ltr"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "1rem",
                  letterSpacing: "0.08em",
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  wordBreak: "break-all",
                }}
              >
                {setupData.secret}
              </Box>
              <Button size="small" onClick={() => void copy(setupData.secret, "secret")}>
                {copied === "secret" ? t("copied") : t("copySecret")}
              </Button>
            </Stack>
          </Box>

          <Typography variant="subtitle1" component="h3" fontWeight={700}>
            {t("step2Title")}
          </Typography>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (totpValid && !confirm.isPending) confirm.mutate(totpCode);
            }}
          >
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="flex-start">
              <TextField
                label={t("codeLabel")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                helperText={t("codeHint")}
                autoComplete="one-time-code"
                slotProps={{
                  htmlInput: { inputMode: "numeric", maxLength: 7, dir: "ltr" },
                }}
                sx={{ maxWidth: 240 }}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!totpValid || confirm.isPending}
                sx={{ mt: { sm: 1 } }}
              >
                {t("confirm")}
              </Button>
              <Button onClick={resetFlow} sx={{ mt: { sm: 1 } }}>
                {t("cancel")}
              </Button>
            </Stack>
          </Box>
          {confirm.isError ? (
            <Alert severity="error">{(confirm.error as Error).message || t("error")}</Alert>
          ) : null}
        </Stack>
      ) : null}

      {step === "codes" && setupData ? (
        <Stack spacing={2}>
          <Alert severity="success">{t("enabledNotice")}</Alert>
          <Typography variant="subtitle1" component="h3" fontWeight={700}>
            {t("backupTitle")}
          </Typography>
          <Alert severity="warning">{t("backupHelp")}</Alert>
          <Box
            component="ul"
            dir="ltr"
            aria-label={t("backupTitle")}
            sx={{
              listStyle: "none",
              m: 0,
              p: 1.5,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 1,
              bgcolor: "action.hover",
              borderRadius: 1,
              fontFamily: "monospace",
            }}
          >
            {setupData.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              onClick={() => void copy(setupData.backupCodes.join("\n"), "codes")}
            >
              {copied === "codes" ? t("copied") : t("copyCodes")}
            </Button>
            <Button variant="contained" onClick={resetFlow}>
              {t("done")}
            </Button>
          </Stack>
        </Stack>
      ) : null}

      {step === "idle" && enabled ? (
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="body2">{t("onDescription")}</Typography>
          <Button
            variant="outlined"
            color="warning"
            onClick={() => {
              setNotice(null);
              setCode("");
              disable.reset();
              setStep("disable");
            }}
          >
            {t("turnOff")}
          </Button>
        </Stack>
      ) : null}

      {step === "disable" ? (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (disableValid && !disable.isPending) disable.mutate(disableCode);
          }}
        >
          <Stack spacing={1.5}>
            <Typography variant="body2">{t("disableHelp")}</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="flex-start">
              <TextField
                label={t("disableCodeLabel")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                slotProps={{ htmlInput: { maxLength: 24, dir: "ltr" } }}
                sx={{ maxWidth: 280 }}
              />
              <Button
                type="submit"
                variant="contained"
                color="warning"
                disabled={!disableValid || disable.isPending}
                sx={{ mt: { sm: 1 } }}
              >
                {t("confirmTurnOff")}
              </Button>
              <Button onClick={resetFlow} sx={{ mt: { sm: 1 } }}>
                {t("cancel")}
              </Button>
            </Stack>
            {disable.isError ? (
              <Alert severity="error">{(disable.error as Error).message || t("error")}</Alert>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}
