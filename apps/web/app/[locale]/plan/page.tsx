"use client";

import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface AccountPlan {
  tier: "free" | "pro";
  cloudProjectLimit: number;
  cloudProjectCount: number;
  remainingCloudSlots: number;
  cloudConfigured: boolean;
  ownerId: string;
  source: "env" | "store" | "default";
  updatedAt: string;
  axes: {
    evidenceRecords: { used: number; limit: number };
    evalRunsPerDay: { used: number; limit: number };
    integrations: { used: number; limit: number };
    retentionDays: { limit: number };
  };
}

export default function PlanPage() {
  const t = useTranslations("plan");
  const queryClient = useQueryClient();

  const planQuery = useQuery({
    queryKey: ["billing-plan"],
    queryFn: () => apiGet<AccountPlan>("/api/v1/billing/plan"),
  });

  const setPlan = useMutation({
    mutationFn: (tier: "free" | "pro") =>
      apiPost<AccountPlan>("/api/v1/billing/plan", { tier }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
    },
  });

  const plan = planQuery.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {plan ? (
        <>
          <Alert severity={plan.cloudConfigured ? "success" : "warning"}>
            {plan.cloudConfigured ? t("cloudOn") : t("cloudOff")}
          </Alert>

          <Box sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}>
            <Typography fontWeight={700}>
              {t("tier")}: {plan.tier.toUpperCase()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("slots", {
                used: plan.cloudProjectCount,
                limit: plan.cloudProjectLimit,
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("remaining", { count: plan.remainingCloudSlots })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("source", { source: plan.source })}
            </Typography>
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
                {t("axisIntegrations", plan.axes.integrations)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("axisRetention", plan.axes.retentionDays)}
              </Typography>
            </Box>
          ) : null}

          <Typography variant="body2">{t("freeHint")}</Typography>
          <Typography variant="body2">{t("proHint")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("stripeLater")}
          </Typography>

          <Stack direction="row" spacing={1}>
            {plan.tier !== "pro" ? (
              <Button
                variant="contained"
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
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
