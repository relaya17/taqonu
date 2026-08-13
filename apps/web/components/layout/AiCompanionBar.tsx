"use client";

import {
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

/** Compact global companion strip — does not dominate the first viewport. */
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

  const title = (p: ProviderItem) =>
    locale === "he" ? p.titleHe : locale === "ar" ? p.titleAr : p.titleEn;

  return (
    <Box
      sx={{
        mb: 1.5,
        py: 0.75,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
      component="section"
      aria-label={t("label")}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="caption" fontWeight={650} sx={{ mr: 0.5 }}>
          {t("title")}
        </Typography>
        <TextField
          select
          size="small"
          label={t("label")}
          value={ready ? providerId : "arletos-included"}
          onChange={(e) => setProviderId(e.target.value)}
          disabled={!ready || options.length === 0}
          sx={{ minWidth: { xs: 160, sm: 200 } }}
        >
          {(options.length > 0
            ? options
            : [
                {
                  id: "arletos-included",
                  titleEn: "ArletOS",
                  titleHe: "ArletOS",
                  titleAr: "ArletOS",
                  billing: "included" as const,
                  creditCost: 0,
                  available: true,
                  kind: "agent" as const,
                },
              ]
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
          label={billing === "credits" ? t("paidActive") : t("freeActive")}
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
    </Box>
  );
}
