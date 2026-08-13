"use client";

import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
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
  source: string;
  subscriptionStatus?: string;
  updatedAt: string;
}

interface CheckoutResponse {
  mode: "live" | "stub";
  checkoutUrl: string | null;
  message?: string;
}

export default function BillingSettingsPage() {
  const t = useTranslations("plan");
  const tSettings = useTranslations("settings");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const checkoutStatus = searchParams.get("checkout");

  const planQuery = useQuery({
    queryKey: ["billing-plan"],
    queryFn: () => apiGet<AccountPlan>("/api/v1/billing/plan"),
  });

  const usageQuery = useQuery({
    queryKey: ["billing-usage"],
    queryFn: () =>
      apiGet<{
        remainingCloudSlots: number;
        cloudProjectCount: number;
        cloudProjectLimit: number;
        tier: string;
      }>("/api/v1/billing/usage"),
  });

  const stripeCheckout = useMutation({
    mutationFn: () =>
      apiPost<CheckoutResponse>("/api/v1/billing/stripe/checkout", {
        tier: "pro",
      }),
    onSuccess: async (data) => {
      if (data.mode === "live" && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      await apiPost("/api/v1/billing/plan", { tier: "pro" });
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
      await queryClient.invalidateQueries({ queryKey: ["billing-usage"] });
    },
  });

  const plan = planQuery.data;
  const usage = usageQuery.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.2rem" }}>
          {t("billingTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("billingSubtitle")}
        </Typography>
      </Box>

      {checkoutStatus === "success" ? (
        <Alert severity="success">{t("checkoutSuccess")}</Alert>
      ) : null}
      {checkoutStatus === "canceled" ? (
        <Alert severity="info">{t("checkoutCanceled")}</Alert>
      ) : null}

      {plan ? (
        <Box sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}>
          <Typography fontWeight={700}>
            {t("tier")}: {plan.tier.toUpperCase()}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("mirrorSlots", {
              used: usage?.cloudProjectCount ?? plan.cloudProjectCount,
              limit: usage?.cloudProjectLimit ?? plan.cloudProjectLimit,
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("sellBanner")}
          </Typography>
          {plan.subscriptionStatus ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("subscriptionStatus", { status: plan.subscriptionStatus })}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        {t("stripeHint")}
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {plan?.tier !== "pro" ? (
          <Button
            variant="contained"
            disabled={stripeCheckout.isPending}
            onClick={() => stripeCheckout.mutate()}
          >
            {t("upgradeStripe")}
          </Button>
        ) : null}
        <Button component={Link} href="/plan" variant="outlined">
          {t("openPlan")}
        </Button>
        <Button component={Link} href="/settings" variant="text">
          {tSettings("title")}
        </Button>
      </Stack>
    </Stack>
  );
}
