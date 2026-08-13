"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet } from "@/lib/api";

interface OracleShell {
  codename: string;
  role: string;
  mission: string;
  gates: string[];
  roadmap: { id: string; title: string; status: string }[];
  allowlist: {
    id: string;
    title: string;
    family: string;
    url: string;
    note: string;
  }[];
  dailyBrief: {
    date: string;
    headline: string;
    items: {
      id: string;
      title: string;
      detail: string;
      epistemicState: string;
      sourceId: string;
      actionHint: string;
    }[];
    note: string;
  };
  surfaces: {
    commandCenter: string;
    truth: string;
    patches: string;
    verifiedSources: string;
  };
}

function statusTone(status: string): string {
  if (status === "DONE") return "#3EC8BE";
  if (status === "PARTIAL") return "#E0B15A";
  return "rgba(232,244,242,0.55)";
}

export default function AdminOraclePage() {
  const oracleQ = useQuery({
    queryKey: ["admin-oracle"],
    queryFn: () =>
      apiGet<{ oracle: OracleShell; note: string }>("/api/v1/admin/oracle"),
    retry: false,
  });

  if (oracleQ.isError) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        <Typography
          sx={{
            fontFamily: '"Syne", "Frank Ruhl Libre", sans-serif',
            fontWeight: 750,
            fontSize: "1.8rem",
          }}
        >
          Admin Oracle
        </Typography>
        <Alert severity="warning">
          נדרשת התחברות כאדמין.{" "}
          <Link href="/admin/login">התחברות</Link>
        </Alert>
      </Stack>
    );
  }

  const oracle = oracleQ.data?.oracle;

  return (
    <Box
      sx={{
        maxWidth: 1040,
        mx: "auto",
        color: "#E8F4F2",
      }}
    >
      <Stack spacing={3}>
        <Box
          sx={{
            p: { xs: 2.5, md: 3.5 },
            borderRadius: 2,
            border: "1px solid rgba(62,200,190,0.28)",
            background: `
              radial-gradient(900px 420px at 8% -20%, rgba(62,200,190,0.2), transparent 55%),
              radial-gradient(700px 360px at 100% 0%, rgba(12,40,48,0.55), transparent 50%),
              linear-gradient(165deg, #041214 0%, #0A2226 48%, #0E2F34 100%)
            `,
            animation: "oracleIn 700ms both",
            "@keyframes oracleIn": {
              from: { opacity: 0, transform: "translateY(10px)" },
              to: { opacity: 1, transform: "none" },
            },
          }}
        >
          <Typography
            sx={{
              fontFamily: '"Syne", "Fraunces", sans-serif',
              fontWeight: 800,
              letterSpacing: "-0.04em",
              fontSize: { xs: "2rem", md: "2.6rem" },
              lineHeight: 1.05,
            }}
          >
            {oracle?.codename ?? "Admin Oracle"}
          </Typography>
          <Typography sx={{ mt: 1, opacity: 0.85, maxWidth: 640 }}>
            {oracle?.role}
          </Typography>
          <Typography sx={{ mt: 1.5, opacity: 0.78, maxWidth: 720 }}>
            {oracle?.mission}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
            <Button
              component={Link}
              href="/admin"
              variant="contained"
              sx={{ bgcolor: "#3EC8BE", color: "#041214", fontWeight: 800 }}
            >
              מרכז פיקוד
            </Button>
            <Button
              component={Link}
              href={oracle?.surfaces.truth ?? "/he/truth"}
              variant="outlined"
              sx={{ borderColor: "rgba(232,244,242,0.35)", color: "#E8F4F2" }}
            >
              ATLAS HEALTH
            </Button>
            <Button
              component={Link}
              href={oracle?.surfaces.patches ?? "/he/patches"}
              variant="text"
              sx={{ color: "#3EC8BE", fontWeight: 650 }}
            >
              Patches / TRUTH_FIX
            </Button>
          </Stack>
        </Box>

        <Box>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 750,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
              opacity: 0.7,
              mb: 1.25,
            }}
          >
            Gates
          </Typography>
          <Stack spacing={0.75}>
            {(oracle?.gates ?? []).map((g) => (
              <Typography key={g} variant="body2" sx={{ opacity: 0.85 }}>
                · {g}
              </Typography>
            ))}
          </Stack>
        </Box>

        <Box>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 750,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
              opacity: 0.7,
              mb: 1.25,
            }}
          >
            Daily brief · {oracle?.dailyBrief.date ?? "—"}
          </Typography>
          <Typography sx={{ mb: 1.5, opacity: 0.8 }}>
            {oracle?.dailyBrief.headline}
          </Typography>
          <Stack spacing={1.5}>
            {(oracle?.dailyBrief.items ?? []).map((item, i) => (
              <Box
                key={item.id}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: "1px solid rgba(232,244,242,0.12)",
                  bgcolor: "rgba(0,0,0,0.22)",
                  animation: `oracleIn 650ms ${80 + i * 70}ms both`,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                  <Chip
                    size="small"
                    label={item.epistemicState}
                    sx={{ bgcolor: "rgba(62,200,190,0.15)", color: "#B7EDE8" }}
                  />
                  <Typography fontWeight={700}>{item.title}</Typography>
                </Stack>
                <Typography variant="body2" sx={{ opacity: 0.82 }}>
                  {item.detail}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.65, display: "block", mt: 0.75 }}>
                  {item.actionHint}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" sx={{ opacity: 0.6, display: "block", mt: 1 }}>
            {oracle?.dailyBrief.note}
          </Typography>
        </Box>

        <Box>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 750,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
              opacity: 0.7,
              mb: 1.25,
            }}
          >
            Allowlist · מקורות מורשים
          </Typography>
          <Stack spacing={1}>
            {(oracle?.allowlist ?? []).map((s) => (
              <Box key={s.id} sx={{ py: 1, borderBottom: "1px solid rgba(232,244,242,0.1)" }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={s.family} variant="outlined" sx={{ borderColor: "rgba(232,244,242,0.25)", color: "#E8F4F2" }} />
                  <Typography
                    component={Link}
                    href={s.url}
                    target={s.url.startsWith("http") ? "_blank" : undefined}
                    rel={s.url.startsWith("http") ? "noreferrer" : undefined}
                    sx={{ color: "#3EC8BE", fontWeight: 650, textDecoration: "none" }}
                  >
                    {s.title}
                  </Typography>
                </Stack>
                <Typography variant="caption" sx={{ opacity: 0.65 }}>
                  {s.note}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        <Box>
          <Typography
            sx={{
              fontFamily: '"Syne", sans-serif',
              fontWeight: 750,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 12,
              opacity: 0.7,
              mb: 1.25,
            }}
          >
            Roadmap A1
          </Typography>
          <Stack spacing={0.75}>
            {(oracle?.roadmap ?? []).map((r) => (
              <Stack key={r.id} direction="row" spacing={1.5} alignItems="center">
                <Typography sx={{ minWidth: 48, fontWeight: 700, color: statusTone(r.status) }}>
                  {r.id}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, opacity: 0.9 }}>
                  {r.title}
                </Typography>
                <Chip
                  size="small"
                  label={r.status}
                  sx={{ bgcolor: "rgba(255,255,255,0.06)", color: statusTone(r.status) }}
                />
              </Stack>
            ))}
          </Stack>
        </Box>

        {oracleQ.data?.note ? (
          <Alert severity="info">{oracleQ.data.note}</Alert>
        ) : null}
      </Stack>
    </Box>
  );
}
