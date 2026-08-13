"use client";

import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";

interface AccountPlan {
  tier: "free" | "pro";
  cloudProjectLimit: number;
  cloudProjectCount: number;
  remainingCloudSlots: number;
  cloudConfigured: boolean;
  ownerId: string;
  source: "env" | "store" | "tenant" | "default";
  updatedAt: string;
  subscriptionStatus?: string;
  stripeCustomerId?: string | null;
  storageModel?: "BYO_CUSTOMER_CLOUD";
  preferredCustomerCloud?: "cloudflare";
  axes: {
    evidenceRecords: { used: number; limit: number };
    evalRunsPerDay: { used: number; limit: number };
    processAuditsPerDay: { used: number; limit: number };
    agentMessagesPerDay: { used: number; limit: number };
    integrations: { used: number; limit: number };
    retentionDays: { limit: number };
  };
}

interface CheckoutResponse {
  mode: "live" | "stub";
  checkoutUrl: string | null;
  message?: string;
  tier?: string | null;
}

interface ByoCloudBinding {
  provider: "cloudflare";
  status: "disconnected" | "connected" | "error";
  accountLabel: string | null;
  externalAccountId: string | null;
  connectedAt: string | null;
  capabilities: string[];
}

interface PlatformInfo {
  version: string;
  storagePolicyVersion: string;
  storageModel: string;
  preferredCustomerCloud: string;
}

export default function PlanPage() {
  const t = useTranslations("plan");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const checkoutStatus = searchParams.get("checkout");
  const [cfLabel, setCfLabel] = useState("");
  const [cfAccountId, setCfAccountId] = useState("");

  const planQuery = useQuery({
    queryKey: ["billing-plan"],
    queryFn: () => apiGet<AccountPlan>("/api/v1/billing/plan"),
  });

  const byoQuery = useQuery({
    queryKey: ["byo-cloud-status"],
    queryFn: () => apiGet<ByoCloudBinding>("/api/v1/byo-cloud/status"),
  });

  const platformQuery = useQuery({
    queryKey: ["platform-info"],
    queryFn: () => apiGet<PlatformInfo>("/api/v1/platform"),
    staleTime: 5 * 60_000,
  });

  const setPlan = useMutation({
    mutationFn: (tier: "free" | "pro") =>
      apiPost<AccountPlan>("/api/v1/billing/plan", { tier }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
    },
  });

  const stripeCheckout = useMutation({
    mutationFn: () =>
      apiPost<CheckoutResponse>("/api/v1/billing/stripe/checkout", {
        tier: "pro",
      }),
    onSuccess: (data) => {
      if (data.mode === "live" && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      void setPlan.mutateAsync("pro");
    },
  });

  const connectCf = useMutation({
    mutationFn: () =>
      apiPost<ByoCloudBinding>("/api/v1/byo-cloud/cloudflare/connect", {
        provider: "cloudflare",
        accountLabel: cfLabel.trim(),
        externalAccountId: cfAccountId.trim() || undefined,
        capabilities: ["workers", "r2", "d1", "kv", "pages"],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["byo-cloud-status"] });
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
      setCfLabel("");
      setCfAccountId("");
    },
  });

  const disconnectCf = useMutation({
    mutationFn: () =>
      apiPost<ByoCloudBinding>("/api/v1/byo-cloud/cloudflare/disconnect", {
        provider: "cloudflare",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["byo-cloud-status"] });
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
    },
  });

  const plan = planQuery.data;
  const byo = byoQuery.data;
  const platform = platformQuery.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        {platform ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            {t("platformVersions", {
              app: platform.version,
              policy: platform.storagePolicyVersion,
              cloud: platform.preferredCustomerCloud,
            })}
          </Typography>
        ) : null}
      </Box>

      {checkoutStatus === "success" ? (
        <Alert severity="success">{t("checkoutSuccess")}</Alert>
      ) : null}
      {checkoutStatus === "canceled" ? (
        <Alert severity="info">{t("checkoutCanceled")}</Alert>
      ) : null}

      <Alert severity="info" sx={{ border: "1px solid", borderColor: "primary.main" }}>
        {t("sellBanner")}
      </Alert>

      <Box sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography fontWeight={700} sx={{ mb: 1 }}>
          {t("byoTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("byoHelp")}
        </Typography>
        {byo?.status === "connected" ? (
          <Stack spacing={1}>
            <Alert severity="success">
              {t("byoConnected", { label: byo.accountLabel ?? "Cloudflare" })}
            </Alert>
            <Button
              variant="outlined"
              color="warning"
              disabled={disconnectCf.isPending}
              onClick={() => disconnectCf.mutate()}
            >
              {t("byoDisconnect")}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label={t("byoLabel")}
              value={cfLabel}
              onChange={(e) => setCfLabel(e.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label={t("byoAccountId")}
              value={cfAccountId}
              onChange={(e) => setCfAccountId(e.target.value)}
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!cfLabel.trim() || connectCf.isPending}
              onClick={() => connectCf.mutate()}
            >
              {t("byoConnect")}
            </Button>
            {connectCf.isError ? (
              <Alert severity="error">{(connectCf.error as Error).message}</Alert>
            ) : null}
          </Stack>
        )}
      </Box>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: 1,
            p: 2.5,
            borderBottom: { xs: "1px solid", md: "none" },
            borderColor: "divider",
            borderInlineEnd: { xs: "none", md: "1px solid" },
          }}
        >
          <Typography fontWeight={700}>{t("freeColumnTitle")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            {t("freeHint")}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, p: 2.5, bgcolor: "rgba(42,46,54,0.06)" }}>
          <Typography fontWeight={700} color="primary">
            {t("proColumnTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            {t("proHint")}
          </Typography>
          {plan?.tier !== "pro" ? (
            <Button
              variant="contained"
              disabled={stripeCheckout.isPending || setPlan.isPending}
              onClick={() => stripeCheckout.mutate()}
            >
              {t("upgradeStripe")}
            </Button>
          ) : null}
        </Box>
      </Stack>

      <Button component={Link} href="/welcome" variant="text" size="small">
        {t("openLanding")}
      </Button>

      {plan ? (
        <>
          <Box sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography fontWeight={700}>
              {t("tier")}: {plan.tier.toUpperCase()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("mirrorSlots", {
                used: plan.cloudProjectCount,
                limit: plan.cloudProjectLimit,
              })}
            </Typography>
            {plan.subscriptionStatus ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("subscriptionStatus", { status: plan.subscriptionStatus })}
              </Typography>
            ) : null}
          </Box>

          {plan.axes ? (
            <Box sx={{ py: 1 }}>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                {t("axesTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisEvidence", plan.axes.evidenceRecords)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisEval", plan.axes.evalRunsPerDay)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisProcessAudit", plan.axes.processAuditsPerDay)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisAgent", plan.axes.agentMessagesPerDay)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisIntegrations", plan.axes.integrations)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisRetention", plan.axes.retentionDays)}
              </Typography>
            </Box>
          ) : null}

          <Typography variant="body2" color="text.secondary">
            {t("stripeHint")}
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {plan.tier !== "pro" ? (
              <Button
                variant="outlined"
                disabled={setPlan.isPending}
                onClick={() => setPlan.mutate("pro")}
              >
                {t("upgradePro")}
              </Button>
            ) : (
              <Button
                variant="outlined"
                disabled={setPlan.isPending}
                onClick={() => setPlan.mutate("free")}
              >
                {t("downgradeFree")}
              </Button>
            )}
            <Button component={Link} href="/settings/billing" variant="text">
              {t("openBilling")}
            </Button>
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
