"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { ProductReel } from "@/components/marketing/ProductReel";
import { atlasChrome as c } from "@/styles/palette";

export function WelcomeLanding({ children }: { children?: ReactNode }) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const router = useRouter();
  const [promoEnded, setPromoEnded] = useState(false);

  const goPlan = () => {
    router.push("/plan");
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: c.ink,
        color: c.text,
        overflow: "clip",
      }}
    >
      <Box
        component="section"
        sx={{
          position: "relative",
          minHeight: { xs: "100svh", md: "100vh" },
          overflow: "hidden",
        }}
      >
        <ProductReel
          onPhaseChange={(p) => setPromoEnded(p === "ended" || p === "error")}
        />

        <Stack
          spacing={2}
          alignItems="center"
          sx={{
            position: "relative",
            zIndex: 2,
            justifyContent: "center",
            minHeight: { xs: "100svh", md: "100vh" },
            px: { xs: 2, sm: 3, md: 4 },
            pt: { xs: 11, sm: 12 },
            pb: { xs: 4, md: 8 },
            width: "100%",
            maxWidth: 640,
            marginInline: "auto",
            boxSizing: "border-box",
            textAlign: "center",
            opacity: promoEnded ? 0 : 1,
            visibility: promoEnded ? "hidden" : "visible",
            pointerEvents: promoEnded ? "none" : "auto",
            transition: "opacity 0.45s ease",
          }}
        >
          <Stack
            spacing={2}
            alignItems="center"
            sx={{
              width: "100%",
              px: { xs: 2, sm: 3 },
              py: { xs: 2.5, sm: 3.5 },
              bgcolor: "rgba(18, 20, 26, 0.48)",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              border: `1px solid ${c.border}`,
              borderRadius: 2,
            }}
          >
          <Typography
            component="p"
            sx={{
              fontFamily: '"Unbounded", "Syne", "Rubik", sans-serif',
              fontWeight: 700,
              fontSize: "clamp(1.6rem, 7vw, 3rem)",
              letterSpacing: "-0.04em",
              lineHeight: 1.05,
              color: c.chromeBright,
              textShadow: "0 2px 24px rgba(0,0,0,0.55)",
            }}
          >
            {t("brand")}
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: '"Rubik", "Source Sans 3", sans-serif',
              fontWeight: 600,
              fontSize: "clamp(1.05rem, 3.2vw, 1.45rem)",
              letterSpacing: "-0.02em",
              lineHeight: 1.35,
              color: c.text,
              maxWidth: 440,
              textShadow: "0 1px 16px rgba(0,0,0,0.5)",
            }}
          >
            {t("headline")}
          </Typography>
          <Typography
            sx={{
              color: c.chrome,
              fontSize: "clamp(0.9rem, 2.4vw, 1.05rem)",
              lineHeight: 1.55,
              maxWidth: 400,
              textShadow: "0 1px 12px rgba(0,0,0,0.45)",
            }}
          >
            {t("subhead")}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            justifyContent="center"
            sx={{ pt: 0.5, width: "100%" }}
          >
            <Button
              component="a"
              href={`/${locale}/auth/register`}
              variant="contained"
              size="large"
              sx={{
                width: { xs: "100%", sm: "auto" },
                bgcolor: c.accent,
                color: c.onAccent,
                fontWeight: 700,
                px: 3,
                "&:hover": { bgcolor: c.accentHover },
              }}
            >
              {t("ctaRegister")}
            </Button>
            <Button
              component="a"
              href={`/${locale}/auth/login`}
              variant="outlined"
              size="large"
              sx={{
                width: { xs: "100%", sm: "auto" },
                borderColor: c.borderStrong,
                color: c.chromeBright,
                fontWeight: 600,
                bgcolor: "rgba(14,17,22,0.35)",
                "&:hover": {
                  borderColor: c.accent,
                  bgcolor: c.hover,
                },
              }}
            >
              {t("ctaLogin")}
            </Button>
            <Button
              component="a"
              href={`/${locale}/partners`}
              size="large"
              sx={{
                width: { xs: "100%", sm: "auto" },
                color: c.chrome,
                fontWeight: 650,
              }}
            >
              {t("ctaAudit")}
            </Button>
          </Stack>
          </Stack>
        </Stack>
      </Box>

      {children}

      <Box
        component="section"
        sx={{
          px: { xs: 2, sm: 3, md: 4 },
          py: { xs: 5, md: 8 },
          borderTop: `1px solid ${c.border}`,
          textAlign: "center",
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Syne", "Rubik", sans-serif',
            fontWeight: 700,
            fontSize: "clamp(1.35rem, 4vw, 2rem)",
            letterSpacing: "-0.03em",
            lineHeight: 1.25,
            mb: 1,
            maxWidth: 560,
            marginInline: "auto",
          }}
        >
          {t("pricingTitle")}
        </Typography>
        <Typography
          sx={{
            color: c.textMuted,
            mb: 4,
            maxWidth: 480,
            marginInline: "auto",
            fontSize: "clamp(0.9rem, 2vw, 1rem)",
            lineHeight: 1.55,
          }}
        >
          {t("pricingBody")}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={0}
          sx={{
            border: `1px solid ${c.borderStrong}`,
            maxWidth: 640,
            marginInline: "auto",
            overflow: "hidden",
            textAlign: "start",
            borderRadius: 2,
          }}
        >
          <Box
            sx={{
              flex: 1,
              p: { xs: 2.5, sm: 3 },
              borderBottom: {
                xs: `1px solid ${c.border}`,
                sm: "none",
              },
              borderInlineEnd: {
                xs: "none",
                sm: `1px solid ${c.border}`,
              },
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "clamp(1.05rem, 2vw, 1.2rem)", mb: 1 }}>
              {t("freeName")}
            </Typography>
            <Typography sx={{ color: c.textMuted, mb: 2, fontSize: "clamp(0.85rem, 1.6vw, 0.95rem)" }}>
              {t("freeDetail")}
            </Typography>
            <Button
              component="a"
              href={`/${locale}/auth/register`}
              variant="outlined"
              sx={{ color: c.text, borderColor: c.borderStrong, width: { xs: "100%", sm: "auto" } }}
            >
              {t("ctaRegister")}
            </Button>
          </Box>
          <Box
            sx={{
              flex: 1,
              p: { xs: 2.5, sm: 3 },
              bgcolor: c.hover,
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "clamp(1.05rem, 2vw, 1.2rem)", mb: 1, color: c.accent }}>
              {t("proName")}
            </Typography>
            <Typography sx={{ color: c.textMuted, mb: 2, fontSize: "clamp(0.85rem, 1.6vw, 0.95rem)" }}>
              {t("proDetail")}
            </Typography>
            <Button
              onClick={goPlan}
              variant="contained"
              sx={{
                bgcolor: c.accent,
                color: c.onAccent,
                fontWeight: 700,
                width: { xs: "100%", sm: "auto" },
                "&:hover": { bgcolor: c.accentHover },
              }}
            >
              {t("ctaUpgrade")}
            </Button>
          </Box>
        </Stack>
      </Box>

    </Box>
  );
}
