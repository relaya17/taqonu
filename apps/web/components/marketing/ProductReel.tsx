"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/** Default cinematic promo — override with NEXT_PUBLIC_MARKETING_VIDEO_URL. */
const DEFAULT_PROMO_VIDEO =
  "https://res.cloudinary.com/dora8sxcb/video/upload/v1786636369/hailuo-2_3_CINEMATIC_VIDEO_SPECIFICATION__THE_INTELLIGENCE_BEHIND_THE_SYSTEM__1._Creati-0_xekane.mp4";

const VIDEO_URL =
  process.env.NEXT_PUBLIC_MARKETING_VIDEO_URL?.trim() || DEFAULT_PROMO_VIDEO;

type PromoPhase = "playing" | "ended" | "error";

/** Full-bleed marketing promo — at video end (or error), register / login CTAs. */
export function ProductReel({
  onPhaseChange,
}: {
  onPhaseChange?: (phase: PromoPhase) => void;
}) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<PromoPhase>("playing");
  const [muted, setMuted] = useState(true);

  const setPromoPhase = useCallback(
    (next: PromoPhase) => {
      setPhase(next);
      onPhaseChange?.(next);
    },
    [onPhaseChange],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    void el.play().catch(() => {
      /* autoplay blocked — user can still use CTAs in hero */
    });
  }, [muted]);

  const replay = () => {
    const el = videoRef.current;
    setPromoPhase("playing");
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => setPromoPhase("ended"));
  };

  const showEnd = phase === "ended" || phase === "error";

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        bgcolor: "#12141A",
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        src={VIDEO_URL}
        autoPlay
        muted
        playsInline
        preload="auto"
        controls={false}
        aria-label={t("reelAria")}
        onEnded={() => setPromoPhase("ended")}
        onError={() => setPromoPhase("error")}
        sx={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: showEnd ? 0.35 : 1,
          transition: "opacity 0.4s ease",
        }}
      />

      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: showEnd
            ? "linear-gradient(180deg, rgba(14,17,22,0.7) 0%, rgba(14,17,22,0.92) 100%)"
            : "linear-gradient(90deg, rgba(14,17,22,0.78) 0%, rgba(14,17,22,0.4) 45%, rgba(14,17,22,0.2) 100%), linear-gradient(180deg, rgba(14,17,22,0.45) 0%, transparent 30%, rgba(14,17,22,0.55) 100%)",
        }}
      />

      {phase === "playing" ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            position: "absolute",
            bottom: { xs: 16, md: 24 },
            insetInlineEnd: { xs: 16, md: 24 },
            zIndex: 3,
          }}
        >
          <Button
            size="small"
            onClick={() => setMuted((m) => !m)}
            sx={{
              color: "#DCDDE1",
              bgcolor: "rgba(14,17,22,0.65)",
              border: "1px solid rgba(154,158,168,0.35)",
              fontWeight: 600,
              "&:hover": { bgcolor: "rgba(14,17,22,0.85)" },
            }}
          >
            {muted ? t("promoUnmute") : t("promoMute")}
          </Button>
          <Button
            size="small"
            onClick={() => setPromoPhase("ended")}
            sx={{
              color: "#DCDDE1",
              bgcolor: "rgba(14,17,22,0.65)",
              border: "1px solid rgba(154,158,168,0.35)",
              fontWeight: 600,
              "&:hover": { bgcolor: "rgba(14,17,22,0.85)" },
            }}
          >
            {t("promoSkip")}
          </Button>
        </Stack>
      ) : null}

      {showEnd ? (
        <Stack
          spacing={2.5}
          alignItems="center"
          justifyContent="center"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 4,
            px: 3,
            textAlign: "center",
            animation: "promoEndIn 0.55s ease-out",
            "@keyframes promoEndIn": {
              from: { opacity: 0, transform: "translateY(18px)" },
              to: { opacity: 1, transform: "translateY(0)" },
            },
          }}
        >
          <Typography
            sx={{
              fontFamily: '"Syne", "Rubik", sans-serif',
              fontWeight: 700,
              fontSize: { xs: "2rem", md: "2.75rem" },
              letterSpacing: "-0.04em",
              color: "#EEEEF0",
            }}
          >
            {t("brand")}
          </Typography>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 650,
              fontSize: { xs: "1.25rem", md: "1.55rem" },
              color: "rgba(180,183,190,0.95)",
              maxWidth: 420,
            }}
          >
            {phase === "error" ? t("promoErrorTitle") : t("promoEndTitle")}
          </Typography>
          <Typography
            sx={{
              color: "rgba(154,163,178,0.9)",
              maxWidth: 380,
              lineHeight: 1.5,
            }}
          >
            {phase === "error" ? t("promoErrorBody") : t("promoEndBody")}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ pt: 1, width: { xs: "100%", sm: "auto" } }}
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
                px: 3.5,
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
                borderColor: "rgba(154,158,168,0.55)",
                color: "#DCDDE1",
                fontWeight: 650,
                px: 3.5,
                "&:hover": {
                  borderColor: "#9A9EA8",
                  bgcolor: "rgba(154,158,168,0.08)",
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
          {phase === "ended" ? (
            <Button
              onClick={replay}
              size="small"
              sx={{ color: "rgba(154,163,178,0.9)", mt: 0.5 }}
            >
              {t("ctaReplay")}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}
