"use client";

import { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet } from "@/lib/api";

const CLOUD_SERVICES = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    placeholder: "https://dash.cloudflare.com/...",
    defaultUrl: "https://dash.cloudflare.com/",
  },
  {
    id: "vercel",
    label: "Vercel",
    placeholder: "https://vercel.com/...",
    defaultUrl: "https://vercel.com/dashboard",
  },
  {
    id: "netlify",
    label: "Netlify",
    placeholder: "https://app.netlify.com/...",
    defaultUrl: "https://app.netlify.com/",
  },
  {
    id: "render",
    label: "Render",
    placeholder: "https://dashboard.render.com/...",
    defaultUrl: "https://dashboard.render.com/",
  },
  {
    id: "supabase",
    label: "Supabase",
    placeholder: "https://supabase.com/dashboard/...",
    defaultUrl: "https://supabase.com/dashboard",
  },
  {
    id: "mongodb",
    label: "MongoDB Atlas",
    placeholder: "https://cloud.mongodb.com/...",
    defaultUrl: "https://cloud.mongodb.com/",
  },
  {
    id: "aws",
    label: "AWS",
    placeholder: "https://console.aws.amazon.com/...",
    defaultUrl: "https://console.aws.amazon.com/",
  },
  {
    id: "azure",
    label: "Azure",
    placeholder: "https://portal.azure.com/...",
    defaultUrl: "https://portal.azure.com/",
  },
  {
    id: "gcp",
    label: "Google Cloud",
    placeholder: "https://console.cloud.google.com/...",
    defaultUrl: "https://console.cloud.google.com/",
  },
  {
    id: "sentry",
    label: "Sentry",
    placeholder: "https://sentry.io/...",
    defaultUrl: "https://sentry.io/",
  },
  {
    id: "stripe",
    label: "Stripe",
    placeholder: "https://dashboard.stripe.com/...",
    defaultUrl: "https://dashboard.stripe.com/",
  },
  {
    id: "github",
    label: "GitHub",
    placeholder: "https://github.com/...",
    defaultUrl: "https://github.com/",
  },
] as const;

type CloudServiceId = (typeof CLOUD_SERVICES)[number]["id"];

const panelBorder = "1px solid rgba(232,234,238,0.12)";
const panelBg = "rgba(28,31,38,0.92)";

/**
 * Cloud console launcher — moved here from the old standalone Workbench page
 * (apps/web/app/[locale]/workbench/page.tsx) so it can live as a tab inside
 * Studio. Same endpoint (/api/v1/providers/adapters), same behavior.
 */
export function CloudToolsPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("workbench");
  const [cloudService, setCloudService] = useState<CloudServiceId>("cloudflare");
  const [cloudUrl, setCloudUrl] = useState("");

  const adaptersQuery = useQuery({
    queryKey: ["provider-adapters"],
    queryFn: () =>
      apiGet<{ items: Array<{ id: string; status: string; note: string }> }>(
        "/api/v1/providers/adapters",
      ),
    staleTime: 5 * 60_000,
  });

  const adapterStatus = useMemo(() => {
    return new Map((adaptersQuery.data?.items ?? []).map((i) => [i.id, i] as const));
  }, [adaptersQuery.data]);

  const activeCloud = CLOUD_SERVICES.find((s) => s.id === cloudService)!;

  return (
    <Box
      sx={{
        border: panelBorder,
        borderRadius: 3,
        bgcolor: panelBg,
        p: embedded ? 2.25 : 1.5,
        boxShadow: embedded ? "0 12px 40px rgba(0,0,0,0.28)" : "none",
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ color: "#8B9099" }}>
          {t("cloudHelp")}
        </Typography>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ gap: 1 }}>
          {CLOUD_SERVICES.map((svc) => {
            const meta = adapterStatus.get(svc.id);
            const status = meta?.status ?? "external";
            return (
              <Chip
                key={svc.id}
                clickable
                size="small"
                color={cloudService === svc.id ? "primary" : "default"}
                variant={cloudService === svc.id ? "filled" : "outlined"}
                label={`${svc.label}${meta ? ` · ${status}` : ""}`}
                onClick={() => {
                  setCloudService(svc.id);
                  setCloudUrl("");
                }}
                sx={
                  cloudService === svc.id
                    ? {}
                    : { color: "#DCDDE1", borderColor: "rgba(232,234,238,0.25)" }
                }
              />
            );
          })}
        </Stack>
        {adapterStatus.get(cloudService)?.note ? (
          <Typography variant="caption" sx={{ color: "#8B9099" }}>
            Atlas: {adapterStatus.get(cloudService)!.note}
          </Typography>
        ) : (
          <Typography variant="caption" sx={{ color: "#8B9099" }}>
            {t("cloudExternal")}
          </Typography>
        )}
        <TextField
          size="small"
          fullWidth
          label={`${activeCloud.label} URL`}
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
          placeholder={activeCloud.placeholder}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#DCDDE1",
              bgcolor: "rgba(255,255,255,0.04)",
              "& fieldset": { borderColor: "rgba(232,234,238,0.2)" },
            },
            "& .MuiInputLabel-root": { color: "rgba(232,234,238,0.7)" },
          }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="contained"
            href={cloudUrl.trim() || activeCloud.defaultUrl}
            target="_blank"
            rel="noopener noreferrer"
            component="a"
          >
            {t("openExternal")}
          </Button>
          <Button
            variant="outlined"
            component={Link}
            href="/integrations"
            sx={{ color: "#DCDDE1", borderColor: "rgba(232,234,238,0.3)" }}
          >
            {t("openIntegrations")}
          </Button>
        </Stack>
        <Alert severity="info">{t("embedNote")}</Alert>
      </Stack>
    </Box>
  );
}
