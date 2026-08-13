"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { ProductReel } from "@/components/marketing/ProductReel";

export function WelcomeLanding() {
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
        bgcolor: "#12141A",
        color: "#DCDDE1",
        overflow: "clip",
        textAlign: "center",
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
          spacing={2.5}
          alignItems="center"
          sx={{
            position: "relative",
            zIndex: 2,
            justifyContent: "center",
            minHeight: { xs: "100svh", md: "100vh" },
            px: { xs: 2.5, sm: 4, md: 7 },
            pt: { xs: 10, md: 12 },
            pb: { xs: 6, md: 10 },
            maxWidth: 560,
            mx: "auto",
            opacity: promoEnded ? 0 : 1,
            visibility: promoEnded ? "hidden" : "visible",
            pointerEvents: promoEnded ? "none" : "auto",
            transition: "opacity 0.45s ease",
          }}
        >
          <Typography
            component="p"
            sx={{
              fontFamily: '"Syne", "Rubik", sans-serif',
              fontWeight: 700,
              fontSize: { xs: "2.75rem", md: "3.6rem" },
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
              color: "#EEEEF0",
              textShadow: "0 2px 24px rgba(0,0,0,0.55)",
            }}
          >
            {t("brand")}
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: '"Syne", "Source Sans 3", sans-serif',
              fontWeight: 600,
              fontSize: { xs: "1.25rem", md: "1.45rem" },
              letterSpacing: "-0.02em",
              color: "#DCDDE1",
              maxWidth: 440,
              textShadow: "0 1px 16px rgba(0,0,0,0.5)",
            }}
          >
            {t("headline")}
          </Typography>
          <Typography
            sx={{
              color: "rgba(212, 216, 224, 0.95)",
              fontSize: "1.05rem",
              lineHeight: 1.5,
              maxWidth: 400,
              textShadow: "0 1px 12px rgba(0,0,0,0.45)",
            }}
          >
            {t("subhead")}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            justifyContent="center"
            sx={{ pt: 0.5 }}
          >
            <Button
              component="a"
              href={`/${locale}/auth/register`}
              variant="contained"
              size="large"
              sx={{
                bgcolor: "#9A9EA8",
                color: "#12141A",
                fontWeight: 700,
                px: 3,
                "&:hover": { bgcolor: "#ADB1BA" },
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
                borderColor: "rgba(232, 234, 238, 0.55)",
                color: "#EEEEF0",
                fontWeight: 600,
                bgcolor: "rgba(14,17,22,0.35)",
                "&:hover": {
                  borderColor: "#9A9EA8",
                  bgcolor: "rgba(154, 158, 168, 0.12)",
                },
              }}
            >
              {t("ctaLogin")}
            </Button>
            <Button
              component="a"
              href={`/${locale}/plan`}
              size="large"
              sx={{ color: "#B4B7BE", fontWeight: 650 }}
            >
              {t("ctaPricing")}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box
        component="section"
        sx={{
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 6, md: 9 },
          borderTop: "1px solid rgba(154, 158, 168, 0.14)",
          background:
            "linear-gradient(180deg, #12141A 0%, #16191F 50%, #12141A 100%)",
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.6rem", md: "2rem" },
            letterSpacing: "-0.03em",
            mb: 1.5,
            maxWidth: 560,
            mx: "auto",
          }}
        >
          {t("whyTitle")}
        </Typography>
        <Typography
          sx={{
            color: "rgba(154, 163, 178, 0.88)",
            fontSize: "1.1rem",
            maxWidth: 520,
            mx: "auto",
            lineHeight: 1.55,
            mb: 4,
          }}
        >
          {t("whyBody")}
        </Typography>
        <Stack spacing={3} sx={{ maxWidth: 520, mx: "auto" }}>
          {(["truth", "govern", "scale"] as const).map((k) => (
            <Box key={k}>
              <Typography
                sx={{
                  fontFamily: '"Syne", sans-serif',
                  fontWeight: 650,
                  fontSize: "1.15rem",
                  color: "#9A9EA8",
                  mb: 0.5,
                }}
              >
                {t(`pillars.${k}.title`)}
              </Typography>
              <Typography sx={{ color: "rgba(154, 163, 178, 0.85)", lineHeight: 1.5 }}>
                {t(`pillars.${k}.body`)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box
        component="section"
        sx={{
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 6, md: 9 },
          borderTop: "1px solid rgba(154, 158, 168, 0.14)",
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.6rem", md: "2rem" },
            letterSpacing: "-0.03em",
            mb: 1,
            maxWidth: 560,
            mx: "auto",
          }}
        >
          {t("pricingTitle")}
        </Typography>
        <Typography
          sx={{
            color: "rgba(154, 163, 178, 0.88)",
            mb: 4,
            maxWidth: 480,
            mx: "auto",
          }}
        >
          {t("pricingBody")}
        </Typography>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={0}
          sx={{
            border: "1px solid rgba(154, 158, 168, 0.22)",
            maxWidth: 640,
            mx: "auto",
            overflow: "hidden",
            textAlign: "start",
          }}
        >
          <Box
            sx={{
              flex: 1,
              p: 3,
              borderBottom: {
                xs: "1px solid rgba(154, 158, 168, 0.18)",
                md: "none",
              },
              borderInlineEnd: {
                xs: "none",
                md: "1px solid rgba(154, 158, 168, 0.18)",
              },
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "1.2rem", mb: 1 }}>
              {t("freeName")}
            </Typography>
            <Typography sx={{ color: "rgba(154, 163, 178, 0.9)", mb: 2 }}>
              {t("freeDetail")}
            </Typography>
            <Button
              component="a"
              href={`/${locale}/auth/register`}
              variant="outlined"
              sx={{ color: "#DCDDE1", borderColor: "rgba(154,158,168,0.45)" }}
            >
              {t("ctaRegister")}
            </Button>
          </Box>
          <Box
            sx={{
              flex: 1,
              p: 3,
              bgcolor: "rgba(154, 158, 168, 0.08)",
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "1.2rem", mb: 1, color: "#9A9EA8" }}>
              {t("proName")}
            </Typography>
            <Typography sx={{ color: "rgba(154, 163, 178, 0.9)", mb: 2 }}>
              {t("proDetail")}
            </Typography>
            <Button
              onClick={goPlan}
              variant="contained"
              sx={{ bgcolor: "#9A9EA8", color: "#12141A", fontWeight: 700, "&:hover": { bgcolor: "#ADB1BA" } }}
            >
              {t("ctaUpgrade")}
            </Button>
          </Box>
        </Stack>
      </Box>

      <Box
        component="section"
        sx={{
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 5, md: 7 },
          borderTop: "1px solid rgba(154, 158, 168, 0.14)",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.4rem", md: "1.75rem" },
            mb: 2,
            maxWidth: 480,
            mx: "auto",
          }}
        >
          {t("closeTitle")}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          justifyContent="center"
          alignItems="center"
        >
          <Button
            component="a"
            href={`/${locale}/auth/register`}
            variant="contained"
            size="large"
            sx={{
              bgcolor: "#9A9EA8",
              color: "#12141A",
              fontWeight: 700,
              px: 4,
              "&:hover": { bgcolor: "#ADB1BA" },
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
              borderColor: "rgba(154,158,168,0.5)",
              color: "#DCDDE1",
              fontWeight: 650,
              px: 4,
            }}
          >
            {t("ctaLogin")}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
