"use client";

import {
  Alert,
  Box,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet } from "@/lib/api";
import { useAiCompanion } from "@/components/providers/AiCompanionProvider";
import { COMPANION_PROVIDER_IDS } from "@/lib/ai-provider-preference";

interface ProviderItem {
  id: string;
  titleEn: string;
  titleHe: string;
  titleAr: string;
  billing: "included" | "credits";
  creditCost: number;
  available: boolean;
  kind: "agent" | "assist" | "both";
}

export function AiCompanionBar() {
  const t = useTranslations("companion");
  const locale = useLocale();
  const { providerId, billing, setProviderId, ready } = useAiCompanion();

  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () =>
      apiGet<{ items: ProviderItem[] }>("/api/v1/ai/providers"),
    staleTime: 5 * 60_000,
  });

  const options = (providers.data?.items ?? []).filter(
    (p) =>
      (COMPANION_PROVIDER_IDS as readonly string[]).includes(p.id) &&
      p.kind !== "assist",
  );

  const selected = options.find((p) => p.id === providerId);
  const title = (p: ProviderItem) =>
    locale === "he" ? p.titleHe : locale === "ar" ? p.titleAr : p.titleEn;

  return (
    <Box
      sx={{
        mb: 2,
        py: 1.5,
        px: { xs: 0, sm: 0 },
        borderBottom: "1px solid rgba(20,32,34,0.1)",
      }}
      component="section"
      aria-label={t("label")}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {t("title")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("help")}
          </Typography>
        </Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "center" }}
          sx={{ minWidth: { sm: 280 } }}
        >
          <TextField
            select
            size="small"
            label={t("label")}
            value={ready ? providerId : "arletos-included"}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={!ready || options.length === 0}
            sx={{ minWidth: { xs: "100%", sm: 220 } }}
          >
            {(options.length > 0
              ? options
              : [{ id: "arletos-included", titleEn: "ArletOS", titleHe: "ArletOS", titleAr: "ArletOS", billing: "included" as const, creditCost: 0, available: true, kind: "agent" as const }]
            ).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {title(p)}
                {p.billing === "credits" ? ` · ${p.creditCost}` : ""}
              </MenuItem>
            ))}
          </TextField>
          <Chip
            size="small"
            color={billing === "credits" ? "warning" : "success"}
            label={
              billing === "credits" ? t("paidActive") : t("freeActive")
            }
          />
          <Typography
            component={Link}
            href="/models"
            variant="caption"
            sx={{ color: "primary.main", whiteSpace: "nowrap" }}
          >
            {t("browseModels")}
          </Typography>
        </Stack>
      </Stack>
      {billing === "credits" ? (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t("paidNote", {
            name: selected ? title(selected) : providerId,
          })}
        </Alert>
      ) : null}
    </Box>
  );
}
