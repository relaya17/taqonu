"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet } from "@/lib/api";
import { useAiCompanion } from "@/components/providers/AiCompanionProvider";
import { COMPANION_PROVIDER_IDS } from "@/lib/ai-provider-preference";

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("atlas.session");
}

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

const STORAGE_KEY = "atlas.companionExpanded";

/** Compact global companion strip — collapsed by default; expand on demand. */
export function AiCompanionBar() {
  const t = useTranslations("companion");
  const locale = useLocale();
  const { providerId, billing, setProviderId, ready } = useAiCompanion();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      setExpanded(stored === "1");
    } catch {
      setExpanded(false);
    }
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.sessionStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    setHasSession(hasSessionCookie());
  }, []);

  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () =>
      apiGet<{ items: ProviderItem[] }>("/api/v1/ai/providers"),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: hasSession,
  });

  const options = (providers.data?.items ?? []).filter(
    (p) =>
      (COMPANION_PROVIDER_IDS as readonly string[]).includes(p.id) &&
      p.kind !== "assist",
  );

  const title = (p: ProviderItem) =>
    locale === "he" ? p.titleHe : locale === "ar" ? p.titleAr : p.titleEn;

  const activeLabel =
    options.find((p) => p.id === providerId)?.titleEn ?? "ArletOS";

  return (
    <Box
      sx={{
        mb: 1,
        py: 0.5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
      component="section"
      aria-label={t("label")}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 0.75,
          minHeight: 36,
        }}
      >
        <Typography
          variant="caption"
          fontWeight={650}
          sx={{ whiteSpace: "nowrap", display: { xs: "none", sm: "inline" } }}
        >
          {t("title")}
        </Typography>
        <Chip
          size="small"
          color={billing === "credits" ? "warning" : "default"}
          variant="outlined"
          label={
            billing === "credits"
              ? `${activeLabel} · ${t("paidActive")}`
              : t("freeActive")
          }
          sx={{ maxWidth: { xs: 180, sm: 240 } }}
        />
        <IconButton
          size="small"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? t("collapse") : t("expand")}
        >
          {expanded ? (
            <ExpandLessIcon fontSize="small" />
          ) : (
            <ExpandMoreIcon fontSize="small" />
          )}
        </IconButton>
      </Box>
      <Collapse in={expanded} sx={{ width: "100%" }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 1,
            pb: 0.75,
            pt: 0.5,
          }}
        >
          <TextField
            select
            size="small"
            label={t("label")}
            value={ready ? providerId : "arletos-included"}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={!ready || options.length === 0}
            sx={{ minWidth: { xs: 150, sm: 200 } }}
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
          <Typography
            component={Link}
            href="/models"
            variant="caption"
            sx={{ color: "primary.main", whiteSpace: "nowrap" }}
          >
            {t("browseModels")}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}
