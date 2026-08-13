"use client";

import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const BEATS = ["verdict", "workbench", "cloud", "upgrade"] as const;

/** Short auto-advancing product story — marketing “video” without an MP4. */
export function ProductReel() {
  const t = useTranslations("landing");
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBeat((b) => (b + 1) % BEATS.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, []);

  const key = BEATS[beat]!;

  return (
    <Box
      role="img"
      aria-label={t("reelAria")}
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: { xs: 280, md: 420 },
        overflow: "hidden",
        background:
          "radial-gradient(ellipse at 30% 20%, rgba(62, 200, 190, 0.22), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(232, 168, 72, 0.14), transparent 50%), linear-gradient(160deg, #061012 0%, #0C1E22 45%, #0A1618 100%)",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(126,184,185,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(126,184,185,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 78%)",
          pointerEvents: "none",
        },
      }}
    >
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          p: { xs: 2.5, md: 4 },
          gap: 1.5,
        }}
      >
        <Typography
          key={key}
          sx={{
            fontFamily: '"Syne", "Fraunces", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.35rem", md: "1.85rem" },
            color: "#E8F4F2",
            letterSpacing: "-0.03em",
            maxWidth: 420,
            animation: "landingFadeUp 0.55s ease-out",
            "@keyframes landingFadeUp": {
              from: { opacity: 0, transform: "translateY(14px)" },
              to: { opacity: 1, transform: "translateY(0)" },
            },
          }}
        >
          {t(`reel.${key}.title`)}
        </Typography>
        <Typography
          key={`${key}-sub`}
          sx={{
            color: "rgba(180, 210, 208, 0.88)",
            fontSize: { xs: "0.95rem", md: "1.05rem" },
            maxWidth: 440,
            lineHeight: 1.45,
            animation: "landingFadeUp 0.7s ease-out",
          }}
        >
          {t(`reel.${key}.body`)}
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 0.75,
            mt: 1,
          }}
        >
          {BEATS.map((_, i) => (
            <Box
              key={i}
              sx={{
                height: 3,
                flex: 1,
                maxWidth: 56,
                borderRadius: 1,
                bgcolor:
                  i === beat ? "#3EC8BE" : "rgba(126, 184, 185, 0.25)",
                transition: "background-color 0.3s ease",
              }}
            />
          ))}
        </Box>
      </Box>

      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: { xs: 24, md: 48 },
          insetInlineEnd: { xs: 20, md: 48 },
          width: { xs: 120, md: 168 },
          height: { xs: 120, md: 168 },
          borderRadius: "50%",
          border: "1px solid rgba(62, 200, 190, 0.35)",
          animation: "landingPulse 4.5s ease-in-out infinite",
          "@keyframes landingPulse": {
            "0%, 100%": { transform: "scale(1)", opacity: 0.55 },
            "50%": { transform: "scale(1.08)", opacity: 0.9 },
          },
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 18,
            borderRadius: "50%",
            border: "1px solid rgba(232, 168, 72, 0.4)",
          },
        }}
      />
    </Box>
  );
}
