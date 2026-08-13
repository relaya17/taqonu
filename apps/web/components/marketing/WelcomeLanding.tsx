"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { ProductReel } from "@/components/marketing/ProductReel";

export function WelcomeLanding() {
  const t = useTranslations("landing");
  const locale = useLocale();
  const router = useRouter();

  const goPlan = () => {
    router.push("/plan");
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#050C0D",
        color: "#E8F4F2",
        overflow: "clip",
      }}
    >
      {/* Hero — one composition: brand, headline, line, CTAs, full-bleed reel */}
      <Box
        component="section"
        sx={{
          position: "relative",
          minHeight: { xs: "100svh", md: "100vh" },
          display: "grid",
          gridTemplateRows: { xs: "auto 1fr", md: "1fr" },
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 0.95fr) minmax(0, 1.05fr)" },
        }}
      >
        <Stack
          spacing={2.5}
          sx={{
            position: "relative",
            zIndex: 2,
            justifyContent: "center",
            px: { xs: 2.5, sm: 4, md: 6 },
            pt: { xs: 8, md: 10 },
            pb: { xs: 4, md: 8 },
            maxWidth: 560,
          }}
        >
          <Typography
            component="p"
            sx={{
              fontFamily: '"Syne", "Rubik", sans-serif',
              fontWeight: 700,
              fontSize: { xs: "2.6rem", md: "3.4rem" },
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
              color: "#F2FBFA",
              animation: "landingHeroIn 0.8s ease-out",
              "@keyframes landingHeroIn": {
                from: { opacity: 0, transform: "translateY(18px)" },
                to: { opacity: 1, transform: "translateY(0)" },
              },
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
              color: "rgba(200, 230, 226, 0.95)",
              maxWidth: 420,
            }}
          >
            {t("headline")}
          </Typography>
          <Typography
            sx={{
              color: "rgba(160, 190, 188, 0.9)",
              fontSize: "1.05rem",
              lineHeight: 1.5,
              maxWidth: 400,
            }}
          >
            {t("subhead")}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ pt: 0.5 }}>
            <Button
              component="a"
              href={`/${locale}/auth/login`}
              variant="contained"
              size="large"
              sx={{
                bgcolor: "#3EC8BE",
                color: "#041214",
                fontWeight: 700,
                px: 3,
                "&:hover": { bgcolor: "#5AD8CF" },
              }}
            >
              {t("ctaStart")}
            </Button>
            <Button
              onClick={goPlan}
              variant="outlined"
              size="large"
              sx={{
                borderColor: "rgba(62, 200, 190, 0.55)",
                color: "#E8F4F2",
                fontWeight: 600,
                "&:hover": {
                  borderColor: "#3EC8BE",
                  bgcolor: "rgba(62, 200, 190, 0.08)",
                },
              }}
            >
              {t("ctaPricing")}
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            position: "relative",
            minHeight: { xs: 300, md: "100%" },
            borderInlineStart: {
              xs: "none",
              md: "1px solid rgba(62, 200, 190, 0.18)",
            },
          }}
        >
          <ProductReel />
        </Box>
      </Box>

      {/* One job: why pay */}
      <Box
        component="section"
        sx={{
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 6, md: 9 },
          borderTop: "1px solid rgba(62, 200, 190, 0.14)",
          background:
            "linear-gradient(180deg, #050C0D 0%, #0A1517 50%, #050C0D 100%)",
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
            maxWidth: 640,
          }}
        >
          {t("whyTitle")}
        </Typography>
        <Typography
          sx={{
            color: "rgba(170, 200, 198, 0.88)",
            fontSize: "1.1rem",
            maxWidth: 560,
            lineHeight: 1.55,
            mb: 4,
          }}
        >
          {t("whyBody")}
        </Typography>
        <Stack spacing={3} sx={{ maxWidth: 720 }}>
          {(["truth", "govern", "scale"] as const).map((k) => (
            <Box key={k}>
              <Typography
                sx={{
                  fontFamily: '"Syne", sans-serif',
                  fontWeight: 650,
                  fontSize: "1.15rem",
                  color: "#3EC8BE",
                  mb: 0.5,
                }}
              >
                {t(`pillars.${k}.title`)}
              </Typography>
              <Typography sx={{ color: "rgba(170, 200, 198, 0.85)", maxWidth: 520 }}>
                {t(`pillars.${k}.body`)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* One job: pricing tease */}
      <Box
        component="section"
        sx={{
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 6, md: 9 },
          borderTop: "1px solid rgba(62, 200, 190, 0.14)",
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
          }}
        >
          {t("pricingTitle")}
        </Typography>
        <Typography
          sx={{
            color: "rgba(170, 200, 198, 0.88)",
            mb: 4,
            maxWidth: 480,
          }}
        >
          {t("pricingBody")}
        </Typography>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={0}
          sx={{
            border: "1px solid rgba(62, 200, 190, 0.22)",
            maxWidth: 720,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              flex: 1,
              p: 3,
              borderBottom: {
                xs: "1px solid rgba(62, 200, 190, 0.18)",
                md: "none",
              },
              borderInlineEnd: {
                xs: "none",
                md: "1px solid rgba(62, 200, 190, 0.18)",
              },
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "1.2rem", mb: 1 }}>
              {t("freeName")}
            </Typography>
            <Typography sx={{ color: "rgba(170, 200, 198, 0.9)", mb: 2 }}>
              {t("freeDetail")}
            </Typography>
            <Button
              component="a"
              href={`/${locale}/auth/login`}
              variant="outlined"
              sx={{ color: "#E8F4F2", borderColor: "rgba(62,200,190,0.45)" }}
            >
              {t("ctaStart")}
            </Button>
          </Box>
          <Box
            sx={{
              flex: 1,
              p: 3,
              bgcolor: "rgba(62, 200, 190, 0.08)",
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: "1.2rem", mb: 1, color: "#3EC8BE" }}>
              {t("proName")}
            </Typography>
            <Typography sx={{ color: "rgba(170, 200, 198, 0.9)", mb: 2 }}>
              {t("proDetail")}
            </Typography>
            <Button
              onClick={goPlan}
              variant="contained"
              sx={{ bgcolor: "#3EC8BE", color: "#041214", fontWeight: 700, "&:hover": { bgcolor: "#5AD8CF" } }}
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
          borderTop: "1px solid rgba(62, 200, 190, 0.14)",
          textAlign: "center",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.4rem", md: "1.75rem" },
            mb: 2,
          }}
        >
          {t("closeTitle")}
        </Typography>
        <Button
          onClick={goPlan}
          variant="contained"
          size="large"
          sx={{
            bgcolor: "#E8A848",
            color: "#1A1004",
            fontWeight: 700,
            px: 4,
            "&:hover": { bgcolor: "#F0BC66" },
          }}
        >
          {t("ctaPricing")}
        </Button>
      </Box>
    </Box>
  );
}
