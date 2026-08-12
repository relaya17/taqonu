"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet } from "@/lib/api";
import { useAiCompanion } from "@/components/providers/AiCompanionProvider";

interface ProviderItem {
  id: string;
  vendor: string;
  titleEn: string;
  titleHe: string;
  titleAr: string;
  billing: "included" | "credits";
  priceTier: "free" | "low" | "mid" | "high";
  creditCost: number;
  kind: "agent" | "assist" | "both";
  skills: string[];
  strengthsEn: string[];
  strengthsHe: string[];
  strengthsAr?: string[];
  weaknessesEn: string[];
  weaknessesHe: string[];
  weaknessesAr?: string[];
  bestForEn: string;
  bestForHe: string;
  bestForAr?: string;
  available: boolean;
  priceLabel: string;
  memoryCount?: number;
}

export default function ModelsPage() {
  const t = useTranslations("models");
  const locale = useLocale();
  const { providerId, setProviderId } = useAiCompanion();
  const [filter, setFilter] = useState<"all" | "agent" | "assist">("all");
  const [tierFilter, setTierFilter] = useState<
    "all" | "free" | "low" | "mid" | "high"
  >("all");

  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () =>
      apiGet<{ items: ProviderItem[]; arletosMemoryCount?: number }>(
        "/api/v1/ai/providers",
      ),
  });

  const credits = useQuery({
    queryKey: ["credits"],
    queryFn: () => apiGet<{ balance: number }>("/api/v1/billing/credits"),
  });

  const items = useMemo(() => {
    let list = providers.data?.items ?? [];
    if (filter !== "all") {
      list = list.filter((p) => p.kind === filter || p.kind === "both");
    }
    if (tierFilter !== "all") {
      list = list.filter((p) => p.priceTier === tierFilter);
    }
    return list;
  }, [providers.data, filter, tierFilter]);

  const title = (p: ProviderItem) =>
    locale === "he" ? p.titleHe : locale === "ar" ? p.titleAr : p.titleEn;
  const strengths = (p: ProviderItem) =>
    locale === "he"
      ? (p.strengthsHe ?? p.strengthsEn)
      : locale === "ar"
        ? (p.strengthsAr ?? p.strengthsEn)
        : p.strengthsEn;
  const weaknesses = (p: ProviderItem) =>
    locale === "he"
      ? (p.weaknessesHe ?? p.weaknessesEn)
      : locale === "ar"
        ? (p.weaknessesAr ?? p.weaknessesEn)
        : p.weaknessesEn;
  const bestFor = (p: ProviderItem) =>
    locale === "he"
      ? p.bestForHe
      : locale === "ar"
        ? (p.bestForAr ?? p.bestForEn)
        : p.bestForEn;

  const tierColor = (tier: ProviderItem["priceTier"]) => {
    if (tier === "free") return "success" as const;
    if (tier === "low") return "info" as const;
    if (tier === "mid") return "warning" as const;
    return "error" as const;
  };

  const priceText = (p: ProviderItem) =>
    p.billing === "included"
      ? t("tier.free")
      : t("creditsPrice", { n: p.creditCost });

  const hoverBody = (p: ProviderItem) => (
    <Box sx={{ maxWidth: 320, p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ color: "#fff" }}>
        {title(p)} · {p.vendor}
      </Typography>
      <Typography variant="body2" sx={{ color: "#fff", mt: 0.5 }}>
        {t("hoverPrice")}: {priceText(p)} ({t(`tier.${p.priceTier}`)})
      </Typography>
      <Typography variant="body2" sx={{ color: "#fff", mt: 0.5 }}>
        {bestFor(p)}
      </Typography>
      <Typography variant="caption" sx={{ color: "#ddd", display: "block", mt: 1 }}>
        {t("skills")}: {p.skills.join(" · ")}
      </Typography>
      {p.id === "arletos-included" ? (
        <Typography variant="caption" sx={{ color: "#9fdfb5", display: "block", mt: 0.5 }}>
          {t("memoryCount", {
            n: p.memoryCount ?? providers.data?.arletosMemoryCount ?? 0,
          })}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("includedNote")}
        </Alert>
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {t("companionActive", { id: providerId })}
        </Alert>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          {t("credits", { balance: credits.data?.balance ?? 0 })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("memoryCount", {
            n: providers.data?.arletosMemoryCount ?? 0,
          })}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {(["all", "agent", "assist"] as const).map((key) => (
          <Chip
            key={key}
            clickable
            color={filter === key ? "primary" : "default"}
            label={t(`filter.${key}`)}
            onClick={() => setFilter(key)}
          />
        ))}
        {(["all", "free", "low", "mid", "high"] as const).map((key) => (
          <Chip
            key={`tier-${key}`}
            clickable
            variant="outlined"
            color={tierFilter === key ? "secondary" : "default"}
            label={key === "all" ? t("filter.allTiers") : t(`tier.${key}`)}
            onClick={() => setTierFilter(key)}
          />
        ))}
        <Button component={Link} href="/plan" size="small" variant="outlined">
          {t("buyCredits")}
        </Button>
        <Button component={Link} href="/agents" size="small" variant="outlined">
          {t("openAgents")}
        </Button>
        <Button component={Link} href="/agent" size="small" variant="contained">
          {t("openAgent")}
        </Button>
      </Stack>

      <Stack spacing={0}>
        {items.map((provider) => (
          <Tooltip
            key={provider.id}
            title={hoverBody(provider)}
            placement="top-start"
            enterDelay={200}
            describeChild
          >
            <Box
              sx={{
                py: 2.5,
                borderBottom: "1px solid rgba(20,32,34,0.12)",
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", md: "1.2fr 1fr 1fr" },
                cursor: "help",
                "&:hover": { backgroundColor: "rgba(20,32,34,0.03)" },
              }}
            >
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Typography fontWeight={700}>{title(provider)}</Typography>
                  <Chip size="small" variant="outlined" label={provider.vendor} />
                  <Chip
                    size="small"
                    color={tierColor(provider.priceTier)}
                    label={`${t(`tier.${provider.priceTier}`)} · ${priceText(provider)}`}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={
                      provider.kind === "assist"
                        ? t("filter.assist")
                        : t("filter.agent")
                    }
                  />
                  {!provider.available ? (
                    <Chip size="small" color="warning" label={t("needsSetup")} />
                  ) : null}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {bestFor(provider)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {t("skills")}: {provider.skills.join(" · ")}
                </Typography>
                {provider.kind !== "assist" ? (
                  <Button
                    size="small"
                    variant={providerId === provider.id ? "contained" : "outlined"}
                    sx={{ mt: 1 }}
                    onClick={() => setProviderId(provider.id)}
                  >
                    {providerId === provider.id
                      ? t("companionSelected")
                      : t("useEverywhere")}
                  </Button>
                ) : (
                  <Button
                    component={Link}
                    href="/artifacts"
                    size="small"
                    sx={{ mt: 1 }}
                  >
                    {t("useInArtifacts")}
                  </Button>
                )}
              </Box>
              <Box>
                <Typography variant="overline">{t("strengths")}</Typography>
                {strengths(provider).map((line) => (
                  <Typography key={line} variant="body2" sx={{ mt: 0.5 }}>
                    + {line}
                  </Typography>
                ))}
              </Box>
              <Box>
                <Typography variant="overline">{t("weaknesses")}</Typography>
                {weaknesses(provider).map((line) => (
                  <Typography key={line} variant="body2" sx={{ mt: 0.5 }}>
                    − {line}
                  </Typography>
                ))}
              </Box>
            </Box>
          </Tooltip>
        ))}
      </Stack>
    </Stack>
  );
}
