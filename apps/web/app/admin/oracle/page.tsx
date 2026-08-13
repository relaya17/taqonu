"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";

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

interface QueueAction {
  id: string;
  kind: string;
  priority: number;
  severity: string;
  title: string;
  detail: string;
  evidenceRefs: string[];
  href: string;
  cta: string;
  source: string;
  blockedAutoApply: boolean;
}

interface ActionQueue {
  generatedAt: string;
  total: number;
  top: QueueAction[];
  counts: {
    critical: number;
    high: number;
    medium: number;
    info: number;
    propose: number;
    notify: number;
  };
  note: string;
}

function statusTone(status: string): string {
  if (status === "DONE") return "#3EC8BE";
  if (status === "PARTIAL") return "#E0B15A";
  return "rgba(232,244,242,0.55)";
}

function severityColor(sev: string): string {
  if (sev === "critical") return "#E07A5F";
  if (sev === "high") return "#E0B15A";
  if (sev === "medium") return "#7EC8C0";
  return "rgba(232,244,242,0.65)";
}

export default function AdminOraclePage() {
  const queryClient = useQueryClient();
  const oracleQ = useQuery({
    queryKey: ["admin-oracle"],
    queryFn: () =>
      apiGet<{
        oracle: OracleShell;
        queue: ActionQueue;
        digest?: {
          date: string;
          summary: string;
          top3: { id: string; title: string; severity: string; href: string; cta: string }[];
        };
        versions?: { id: string; title: string; severity: string; detail: string; recommendation: string }[];
        cyber?: { id: string; title: string; severity: string; detail: string; sourceUrl: string; remediation: string }[];
        audit?: { id: string; at: string; type: string; summary: string; actor: string }[];
        watchdogScore: number;
        note: string;
      }>("/api/v1/admin/oracle"),
    retry: false,
    refetchInterval: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () =>
      apiPost<{ ok: boolean; message: string; queue: ActionQueue }>(
        "/api/v1/admin/oracle/refresh-queue",
        {},
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-oracle"] });
    },
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
  const queue = oracleQ.data?.queue;
  const actions = queue?.top ?? [];
  const digest = oracleQ.data?.digest;
  const versions = oracleQ.data?.versions ?? [];
  const cyber = oracleQ.data?.cyber ?? [];
  const audit = oracleQ.data?.audit ?? [];

  return (
    <Box sx={{ maxWidth: 1040, mx: "auto", color: "#E8F4F2" }}>
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
            <Chip
              label={`ציון ${oracleQ.data?.watchdogScore ?? "—"}`}
              sx={{ bgcolor: "#3EC8BE", color: "#041214", fontWeight: 700 }}
            />
            <Chip
              label={`תור ${queue?.total ?? 0}`}
              variant="outlined"
              sx={{ borderColor: "rgba(62,200,190,0.45)", color: "#E8F4F2" }}
            />
            <Button
              variant="contained"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
              sx={{ bgcolor: "#3EC8BE", color: "#041214", fontWeight: 800 }}
            >
              {refresh.isPending ? "מרענן…" : "רענון תור פעולות"}
            </Button>
            <Button
              component={Link}
              href="/admin"
              variant="outlined"
              sx={{ borderColor: "rgba(232,244,242,0.35)", color: "#E8F4F2" }}
            >
              מרכז פיקוד
            </Button>
            <Button
              component={Link}
              href={oracle?.surfaces.truth ?? "/he/truth"}
              variant="text"
              sx={{ color: "#3EC8BE", fontWeight: 650 }}
            >
              ATLAS HEALTH
            </Button>
          </Stack>
        </Box>

        {refresh.isSuccess ? (
          <Alert severity={refresh.data.queue.counts.critical > 0 ? "error" : "success"}>
            {refresh.data.message}
          </Alert>
        ) : null}
        {refresh.isError ? (
          <Alert severity="error">{(refresh.error as Error).message}</Alert>
        ) : null}

        {digest ? (
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
              Morning digest · {digest.date}
            </Typography>
            <Typography sx={{ mb: 1.5, opacity: 0.85 }}>{digest.summary}</Typography>
            <Stack spacing={1}>
              {digest.top3.map((t, i) => (
                <Box
                  key={t.id}
                  sx={{
                    p: 1.75,
                    borderRadius: 2,
                    border: "1px solid rgba(62,200,190,0.22)",
                    bgcolor: "rgba(0,0,0,0.2)",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={`#${i + 1}`} sx={{ bgcolor: "#3EC8BE", color: "#041214", fontWeight: 800 }} />
                    <Chip size="small" label={t.severity} sx={{ bgcolor: "rgba(255,255,255,0.06)", color: severityColor(t.severity) }} />
                    <Typography fontWeight={700}>{t.title}</Typography>
                  </Stack>
                  <Typography variant="caption" sx={{ opacity: 0.65, display: "block", mt: 0.5 }}>
                    {t.cta}
                  </Typography>
                  <Button component={Link} href={t.href} size="small" sx={{ mt: 0.75, color: "#3EC8BE", fontWeight: 700 }}>
                    פתח
                  </Button>
                </Box>
              ))}
            </Stack>
          </Box>
        ) : null}

        {(versions.length > 0 || cyber.length > 0) ? (
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
              Versions · defensive cyber
            </Typography>
            <Stack spacing={1}>
              {versions.slice(0, 5).map((v) => (
                <Alert key={v.id} severity={v.severity === "high" || v.severity === "critical" ? "warning" : "info"}>
                  <Typography fontWeight={700}>{v.title}</Typography>
                  <Typography variant="body2">{v.detail}</Typography>
                  <Typography variant="caption">{v.recommendation}</Typography>
                </Alert>
              ))}
              {cyber.slice(0, 5).map((c) => (
                <Alert key={c.id} severity="warning">
                  <Typography fontWeight={700}>{c.title}</Typography>
                  <Typography variant="body2">{c.detail}</Typography>
                  <Typography variant="caption" display="block">{c.remediation}</Typography>
                  <Button component={Link} href={c.sourceUrl} target="_blank" rel="noreferrer" size="small">
                    מקור advisory
                  </Button>
                </Alert>
              ))}
            </Stack>
          </Box>
        ) : null}

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
            Action queue · detect → rank → notify / propose
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Chip size="small" label={`critical ${queue?.counts.critical ?? 0}`} sx={{ bgcolor: "rgba(224,122,95,0.2)", color: "#F2C4B8" }} />
            <Chip size="small" label={`high ${queue?.counts.high ?? 0}`} sx={{ bgcolor: "rgba(224,177,90,0.18)", color: "#F0D7A0" }} />
            <Chip size="small" label={`propose ${queue?.counts.propose ?? 0}`} sx={{ bgcolor: "rgba(62,200,190,0.15)", color: "#B7EDE8" }} />
            <Chip size="small" label={`notify ${queue?.counts.notify ?? 0}`} sx={{ bgcolor: "rgba(255,255,255,0.06)", color: "#E8F4F2" }} />
          </Stack>
          {actions.length === 0 ? (
            <Alert severity="success">אין פעולות דחופות בתור.</Alert>
          ) : (
            <Stack spacing={1.25}>
              {actions.slice(0, 12).map((a, i) => (
                <Box
                  key={a.id}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: "1px solid rgba(232,244,242,0.12)",
                    bgcolor: "rgba(0,0,0,0.22)",
                    animation: `oracleIn 650ms ${60 + i * 50}ms both`,
                  }}
                >
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: 0.75 }}>
                    <Chip size="small" label={a.severity} sx={{ bgcolor: "rgba(255,255,255,0.06)", color: severityColor(a.severity) }} />
                    <Chip size="small" label={a.kind} sx={{ bgcolor: "rgba(62,200,190,0.12)", color: "#B7EDE8" }} />
                    <Chip size="small" label={a.source} variant="outlined" sx={{ borderColor: "rgba(232,244,242,0.2)", color: "#E8F4F2" }} />
                    {a.blockedAutoApply ? (
                      <Chip size="small" label="no auto-apply" variant="outlined" sx={{ borderColor: "rgba(224,122,95,0.45)", color: "#F2C4B8" }} />
                    ) : null}
                    <Typography fontWeight={700}>{a.title}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ opacity: 0.82 }}>
                    {a.detail}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.65, display: "block", mt: 0.75 }}>
                    {a.cta}
                  </Typography>
                  {(a.evidenceRefs?.length ?? 0) > 0 ? (
                    <Typography variant="caption" sx={{ opacity: 0.55, display: "block", mt: 0.5 }}>
                      evidence: {a.evidenceRefs.slice(0, 4).join(" · ")}
                    </Typography>
                  ) : null}
                  <Button
                    component={Link}
                    href={a.href}
                    size="small"
                    sx={{ mt: 1, color: "#3EC8BE", fontWeight: 700 }}
                  >
                    פתח
                  </Button>
                </Box>
              ))}
            </Stack>
          )}
          <Typography variant="caption" sx={{ opacity: 0.6, display: "block", mt: 1 }}>
            {queue?.note}
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

        {oracleQ.data?.note ? <Alert severity="info">{oracleQ.data.note}</Alert> : null}

        {audit.length > 0 ? (
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
              Audit trail
            </Typography>
            <Stack spacing={0.75}>
              {audit.slice(0, 8).map((e) => (
                <Typography key={e.id} variant="body2" sx={{ opacity: 0.8 }}>
                  {e.at} · {e.type} · {e.summary} · {e.actor}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
