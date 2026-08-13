"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/** Default cinematic promo — override with NEXT_PUBLIC_MARKETING_VIDEO_URL. */
const DEFAULT_PROMO_VIDEO =
  "https://res.cloudinary.com/dora8sxcb/video/upload/v1786636369/hailuo-2_3_CINEMATIC_VIDEO_SPECIFICATION__THE_INTELLIGENCE_BEHIND_THE_SYSTEM__1._Creati-0_xekane.mp4";

const VIDEO_URL =
  process.env.NEXT_PUBLIC_MARKETING_VIDEO_URL?.trim() || DEFAULT_PROMO_VIDEO;

function isYouTube(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

function youTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/embed/${u.pathname.replace("/", "")}?rel=0&autoplay=1&mute=1`;
    }
    const id = u.searchParams.get("v");
    return id
      ? `https://www.youtube.com/embed/${id}?rel=0&autoplay=1&mute=1`
      : null;
  } catch {
    return null;
  }
}

type PromoPhase = "playing" | "ended";

/** Full-bleed marketing promo — at video end, register / login CTAs. */
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

  const replay = () => {
    const el = videoRef.current;
    if (!el) return;
    setPromoPhase("playing");
    el.currentTime = 0;
    void el.play().catch(() => {
      /* autoplay may still be blocked after user gesture */
    });
  };

  const yt = isYouTube(VIDEO_URL) ? youTubeEmbed(VIDEO_URL) : null;

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        bgcolor: "#040A0B",
      }}
    >
      {yt ? (
        <Box
          component="iframe"
          title={t("reelAria")}
          src={yt}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
      ) : (
        <Box
          component="video"
          ref={videoRef}
          src={VIDEO_URL}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          aria-label={t("reelAria")}
          onEnded={() => setPromoPhase("ended")}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* Atmosphere veil — keeps brand readable without sticking cards on media */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            phase === "ended"
              ? "linear-gradient(180deg, rgba(4,10,11,0.55) 0%, rgba(4,10,11,0.88) 55%, rgba(4,10,11,0.96) 100%)"
              : "linear-gradient(90deg, rgba(4,10,11,0.72) 0%, rgba(4,10,11,0.35) 42%, rgba(4,10,11,0.15) 100%), linear-gradient(180deg, rgba(4,10,11,0.35) 0%, transparent 28%, rgba(4,10,11,0.55) 100%)",
          transition: "background 0.6s ease",
        }}
      />

      {phase === "playing" && !yt ? (
        <Button
          size="small"
          onClick={() => {
            setMuted((m) => {
              const next = !m;
              if (videoRef.current) videoRef.current.muted = next;
              return next;
            });
          }}
          sx={{
            position: "absolute",
            bottom: { xs: 16, md: 24 },
            insetInlineEnd: { xs: 16, md: 24 },
            zIndex: 3,
            color: "#E8F4F2",
            bgcolor: "rgba(4,10,11,0.55)",
            border: "1px solid rgba(62,200,190,0.35)",
            fontWeight: 600,
            "&:hover": { bgcolor: "rgba(4,10,11,0.75)" },
          }}
        >
          {muted ? t("promoUnmute") : t("promoMute")}
        </Button>
      ) : null}

      {phase === "ended" ? (
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
              color: "#F2FBFA",
            }}
          >
            {t("brand")}
          </Typography>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 650,
              fontSize: { xs: "1.25rem", md: "1.55rem" },
              color: "rgba(200,230,226,0.95)",
              maxWidth: 420,
            }}
          >
            {t("promoEndTitle")}
          </Typography>
          <Typography
            sx={{
              color: "rgba(170,200,198,0.9)",
              maxWidth: 380,
              lineHeight: 1.5,
            }}
          >
            {t("promoEndBody")}
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
                bgcolor: "#3EC8BE",
                color: "#041214",
                fontWeight: 700,
                px: 3.5,
                "&:hover": { bgcolor: "#5AD8CF" },
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
                borderColor: "rgba(62,200,190,0.55)",
                color: "#E8F4F2",
                fontWeight: 650,
                px: 3.5,
                "&:hover": {
                  borderColor: "#3EC8BE",
                  bgcolor: "rgba(62,200,190,0.08)",
                },
              }}
            >
              {t("ctaLogin")}
            </Button>
          </Stack>
          <Button
            onClick={replay}
            size="small"
            sx={{ color: "rgba(160,190,188,0.9)", mt: 0.5 }}
          >
            {t("ctaReplay")}
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}
