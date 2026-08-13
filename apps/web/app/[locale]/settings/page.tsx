"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  provider: string;
  locale: "he" | "en" | "ar";
  avatarUrl?: string | null;
  emailVerified?: boolean;
  disabled?: boolean;
  hasPassword?: boolean;
}

interface DeviceSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [locale, setLocale] = useState<"he" | "en" | "ar">("he");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const session = await apiGet<{
        authenticated: boolean;
        user: AuthUser | null;
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

  const sessions = useQuery({
    queryKey: ["auth-sessions"],
    enabled: Boolean(me.data?.authenticated),
    queryFn: () =>
      apiGet<{ items: DeviceSession[]; currentSessionId: string | null }>(
        "/api/v1/auth/sessions",
      ),
  });

  useEffect(() => {
    const u = me.data?.user;
    if (!u) return;
    setDisplayName(u.displayName ?? "");
    setLocale(u.locale ?? "he");
    setAvatarUrl(u.avatarUrl ?? "");
  }, [me.data?.user]);

  const saveProfile = useMutation({
    mutationFn: () =>
      apiPatch<{ user: AuthUser }>("/api/v1/auth/profile", {
        displayName: displayName.trim() || null,
        locale,
        avatarUrl: avatarUrl.trim() || null,
      }),
    onSuccess: () => {
      setNotice(t("profileSaved"));
      void queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    },
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/auth/password/change", {
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setNotice(t("passwordChanged"));
      void queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    },
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) =>
      apiPost("/api/v1/auth/sessions/revoke", { sessionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => apiPost("/api/v1/auth/sessions/revoke-others", {}),
    onSuccess: () => {
      setNotice(t("sessionsRevoked"));
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
  });

  const deleteAccount = useMutation({
    mutationFn: () =>
      apiDelete("/api/v1/auth/account", {
        password: deletePassword || undefined,
        confirmEmail: deleteEmail || undefined,
      }),
    onSuccess: () => {
      window.location.href = `/${locale}/welcome`;
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {notice ? (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}

      {me.isError || !me.data ? (
        <Alert severity="info">
          {t("signedOut")}{" "}
          <Link href="/auth/login">{t("goLogin")}</Link>
          {" · "}
          <Link href="/auth/register">{t("goRegister")}</Link>
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar
              src={me.data.user.avatarUrl ?? undefined}
              alt=""
              sx={{ width: 56, height: 56, bgcolor: "#9A9EA8", color: "#12141A" }}
            >
              {(me.data.user.displayName ?? me.data.user.email).slice(0, 1).toUpperCase()}
            </Avatar>
            <Box>
              <Typography fontWeight={700}>
                {me.data.user.displayName ?? me.data.user.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {me.data.user.email} · {me.data.user.provider} · {me.data.user.role}
                {me.data.user.emailVerified ? ` · ${t("verified")}` : ` · ${t("unverified")}`}
              </Typography>
            </Box>
          </Stack>

          <Box>
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
              {t("profileTitle")}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label={t("displayName")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                fullWidth
              />
              <TextField
                select
                label={t("locale")}
                value={locale}
                onChange={(e) => setLocale(e.target.value as "he" | "en" | "ar")}
                fullWidth
              >
                <MenuItem value="he">עברית</MenuItem>
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="ar">العربية</MenuItem>
              </TextField>
              <TextField
                label={t("avatarUrl")}
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                fullWidth
                helperText={t("avatarHint")}
              />
              <Button
                variant="contained"
                onClick={() => saveProfile.mutate()}
                disabled={saveProfile.isPending}
              >
                {t("saveProfile")}
              </Button>
              {saveProfile.isError ? (
                <Alert severity="error">{(saveProfile.error as Error).message}</Alert>
              ) : null}
            </Stack>
          </Box>

          <Divider />

          {me.data.user.hasPassword ? (
            <Box>
              <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
                {t("passwordTitle")}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  type="password"
                  label={t("currentPassword")}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  fullWidth
                />
                <TextField
                  type="password"
                  label={t("newPassword")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  fullWidth
                  helperText={t("passwordHint")}
                />
                <Button
                  variant="outlined"
                  disabled={
                    changePassword.isPending ||
                    currentPassword.length < 1 ||
                    newPassword.length < 8
                  }
                  onClick={() => changePassword.mutate()}
                >
                  {t("changePassword")}
                </Button>
                {changePassword.isError ? (
                  <Alert severity="error">
                    {(changePassword.error as Error).message}
                  </Alert>
                ) : null}
              </Stack>
            </Box>
          ) : (
            <Alert severity="info">{t("oauthNoPassword")}</Alert>
          )}

          <Divider />

          <Box>
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
              {t("sessionsTitle")}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t("sessionsHelp")}
            </Typography>
            <Stack spacing={1.5}>
              {(sessions.data?.items ?? []).map((s) => (
                <Box
                  key={s.id}
                  sx={{
                    py: 1.5,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Box>
                    <Typography fontWeight={600}>
                      {s.current ? t("currentSession") : t("otherSession")}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {(s.userAgent ?? "—").slice(0, 80)}
                      {s.ip ? ` · ${s.ip}` : ""}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("lastSeen", {
                        at: new Date(s.lastSeenAt).toLocaleString(),
                      })}
                    </Typography>
                  </Box>
                  {!s.current ? (
                    <Button
                      size="small"
                      color="warning"
                      onClick={() => revokeSession.mutate(s.id)}
                    >
                      {t("revokeSession")}
                    </Button>
                  ) : null}
                </Box>
              ))}
            </Stack>
            <Button
              sx={{ mt: 2 }}
              variant="outlined"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
            >
              {t("revokeOthers")}
            </Button>
          </Box>

          <Divider />

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

          <Box
            sx={{
              p: 2,
              border: "1px solid",
              borderColor: "error.light",
              borderRadius: 1,
            }}
          >
            <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1, color: "error.main" }}>
              {t("dangerTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("dangerHelp")}
            </Typography>
            <Stack spacing={2}>
              {me.data.user.hasPassword ? (
                <TextField
                  type="password"
                  label={t("confirmPassword")}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  fullWidth
                />
              ) : (
                <TextField
                  label={t("confirmEmail")}
                  value={deleteEmail}
                  onChange={(e) => setDeleteEmail(e.target.value)}
                  fullWidth
                />
              )}
              <Button
                color="error"
                variant="contained"
                disabled={deleteAccount.isPending}
                onClick={() => {
                  if (window.confirm(t("dangerConfirm"))) deleteAccount.mutate();
                }}
              >
                {t("deleteAccount")}
              </Button>
              {deleteAccount.isError ? (
                <Alert severity="error">
                  {(deleteAccount.error as Error).message}
                </Alert>
              ) : null}
            </Stack>
          </Box>
        </>
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
