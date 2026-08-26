"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet, apiPost, downloadVerifiedSourcesPack } from "@/lib/api";
import { HealthPanel } from "@/components/admin/CommandCenter/HealthPanel";
import { ApprovalQueuePanel } from "@/components/admin/CommandCenter/ApprovalQueuePanel";
import { AgentLifecyclePanel } from "@/components/admin/CommandCenter/AgentLifecyclePanel";
import { CostIntelligencePanel } from "@/components/admin/CommandCenter/CostIntelligencePanel";

interface WatchAlert {
  id: string;
  severity: "critical" | "high" | "medium" | "info";
  code: string;
  title: string;
  detail: string;
  remediation: string;
  detectedAt: string;
}

interface KnowledgeGraphSummary {
  projects: number;
  evidenceRecords: number;
  claims: number;
  memories: number;
  decisions: number;
  patches: number;
  agentRuns: number;
  processAuditsToday: number;
  linkedWorkspaces: number;
  byoCloudConnected: number;
  epistemicUnknownProjects: number;
}

interface CommandCenter {
  platform: {
    name: string;
    codename: string;
    version: string;
    storagePolicyVersion: string;
  };
  tier: string;
  generatedAt: string;
  watchdog: {
    score: number;
    alertCount: number;
    criticalCount: number;
    highCount: number;
    alerts: WatchAlert[];
    knowledge: KnowledgeGraphSummary;
    automation: {
      lastWatchdogAt: string | null;
      lastPortfolioHealthAt: string | null;
      lastProcessAuditAt: string | null;
      recommendedIntervalMinutes: number;
      overdue: boolean;
    };
  };
}

interface Overview {
  userCount: number;
  adminCount: number;
  providers: { local: number; google: number; github: number; apple: number };
  cloudAuth: boolean;
}

function severityColor(
  s: WatchAlert["severity"],
): "error" | "warning" | "info" | "success" {
  if (s === "critical") return "error";
  if (s === "high") return "warning";
  if (s === "medium") return "info";
  return "success";
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Box
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        minWidth: 140,
        flex: "1 1 140px",
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: '"Syne", "Fraunces", sans-serif', fontWeight: 700, fontSize: "1.4rem", mt: 0.5 }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function AdminHomePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiGet<Overview>("/api/v1/admin/overview"),
    retry: false,
  });

  const command = useQuery({
    queryKey: ["admin-command-center"],
    queryFn: () => apiGet<CommandCenter>("/api/v1/admin/command-center"),
    retry: false,
    refetchInterval: 60_000,
  });

  const runChecks = useMutation({
    mutationFn: () =>
      apiPost<{ ok: boolean; message: string; report: CommandCenter["watchdog"] }>(
        "/api/v1/admin/automation/run-checks",
        {},
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-command-center"] });
    },
  });

  const wd = command.data?.watchdog;
  const knowledge = wd?.knowledge;
  const alerts = wd?.alerts ?? [];

  const posture = useMemo(() => {
    if (!wd) return "טוען…";
    if (wd.criticalCount > 0) return "קריטי — לטפל עכשיו";
    if (wd.highCount > 0) return "סיכון גבוה — ניטור פעיל";
    if (wd.alertCount > 0) return "יציב עם אזהרות";
    return "יציב · ניטור נקי";
  }, [wd]);

  if (overview.isError || command.isError) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        <Typography
          variant="h1"
          sx={{ fontFamily: '"Syne", "Frank Ruhl Libre", sans-serif' }}
        >
          מרכז פיקוד
        </Typography>
        <Alert severity="warning">
          נדרשת התחברות כאדמין.{" "}
          <Link href="/admin/login">התחברות</Link>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 1100, width: "100%" }}>
      <Box
        sx={{
          p: { xs: 2.5, md: 3.5 },
          background:
            "radial-gradient(ellipse at 12% 0%, rgba(154,158,168,0.18), transparent 50%), radial-gradient(ellipse at 90% 10%, rgba(154,158,168,0.12), transparent 45%), linear-gradient(160deg, #12141A 0%, #1C1F26 55%, #16191F 100%)",
          color: "#DCDDE1",
          border: "1px solid rgba(154,158,168,0.22)",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Syne", "Frank Ruhl Libre", sans-serif',
            fontWeight: 700,
            fontSize: { xs: "1.8rem", md: "2.4rem" },
            letterSpacing: "-0.03em",
          }}
        >
          מרכז פיקוד · {command.data?.platform.name ?? "ArletOS"}
        </Typography>
        <Typography sx={{ mt: 1, color: "rgba(154,163,178,0.9)", maxWidth: 640 }}>
          Admin Oracle מנהל את הלוח — אוטומציה · גרף ידע · ניטור פרואקטיבי · מקורות
          מאומתים בלבד · סייבר הגנתי
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <Chip
            label={`ציון יציבות ${wd?.score ?? "—"}`}
            sx={{ bgcolor: "#9A9EA8", color: "#12141A", fontWeight: 700 }}
          />
          <Chip
            label={posture}
            variant="outlined"
            sx={{ borderColor: "rgba(154,158,168,0.45)", color: "#DCDDE1" }}
          />
          <Chip
            label={`v${command.data?.platform.version ?? "—"} · policy ${command.data?.platform.storagePolicyVersion ?? "—"}`}
            variant="outlined"
            sx={{ borderColor: "rgba(154,158,168,0.35)", color: "rgba(180,183,190,0.9)" }}
          />
          <Chip
            label={`תוכנית ${command.data?.tier?.toUpperCase() ?? "—"}`}
            variant="outlined"
            sx={{ borderColor: "rgba(232,168,72,0.45)", color: "#F0D9A8" }}
          />
        </Stack>
        {wd ? (
          <Box sx={{ mt: 2.5, maxWidth: 420 }}>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              מדד בריאות מערכת
            </Typography>
            <LinearProgress
              variant="determinate"
              value={wd.score}
              sx={{
                mt: 0.75,
                height: 8,
                bgcolor: "rgba(255,255,255,0.08)",
                "& .MuiLinearProgress-bar": {
                  bgcolor: wd.score >= 80 ? "#9A9EA8" : wd.score >= 55 ? "#E8A848" : "#E05A4F",
                },
              }}
            />
          </Box>
        ) : null}
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          disabled={runChecks.isPending}
          onClick={() => runChecks.mutate()}
          sx={{ fontWeight: 700 }}
        >
          {runChecks.isPending ? "רץ בדיקות…" : "הפעל אוטומציית ניטור עכשיו"}
        </Button>
        <Button variant="outlined" onClick={() => downloadVerifiedSourcesPack("json")}>
          מקורות מאומתים JSON
        </Button>
        <Button variant="outlined" onClick={() => downloadVerifiedSourcesPack("markdown")}>
          מקורות Markdown
        </Button>
        <Button component={Link} href="/admin/oracle" variant="outlined">
          Admin Oracle
        </Button>
        <Button component={Link} href="/admin/users" variant="text">
          משתמשים
        </Button>
        <Button component={Link} href="/admin/leads" variant="text">
          לידים
        </Button>
      </Stack>

      {runChecks.isSuccess ? (
        <Alert severity={runChecks.data.report.criticalCount > 0 ? "error" : "success"}>
          {runChecks.data.message}
        </Alert>
      ) : null}
      {runChecks.isError ? (
        <Alert severity="error">{(runChecks.error as Error).message}</Alert>
      ) : null}

      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab label="סקירה" />
        <Tab label={`ניטור (${alerts.length})`} />
        <Tab label="גרף ידע" />
        <Tab label="אוטומציה" />
        <Tab label="בריאות מערכת" />
        <Tab label="תור אישורים" />
        <Tab label="סוכנים" />
        <Tab label="עלויות AI" />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={2}>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Metric label="משתמשים" value={overview.data?.userCount ?? "—"} />
            <Metric label="אדמינים" value={overview.data?.adminCount ?? "—"} />
            <Metric label="פרויקטים" value={knowledge?.projects ?? "—"} />
            <Metric label="ראיות" value={knowledge?.evidenceRecords ?? "—"} />
            <Metric label="Workspaces מקושרים" value={knowledge?.linkedWorkspaces ?? "—"} />
            <Metric
              label="Cloudflare BYO"
              value={knowledge?.byoCloudConnected ? "מחובר" : "לא מחובר"}
            />
          </Stack>
          <Alert severity={overview.data?.cloudAuth ? "success" : "info"}>
            {overview.data?.cloudAuth
              ? "Supabase Cloud פעיל — OAuth + RLS"
              : "מצב מקומי — אימייל/סיסמה; הפעילו Supabase ל-OAuth מלא"}
          </Alert>
          <Alert severity="success">
            מדיניות ידע: כל מידע חיצוני לסוכנים חייב ממקור מאומת (allow-list). הזרקת
            URL זר נחסמת ב־API.
          </Alert>
        </Stack>
      ) : null}

      {tab === 1 ? (
        <Stack spacing={1.5}>
          <Typography color="text.secondary">
            התראות פרואקטיביות — מזוהות לפני שהמשתמש נתקל בכשל קשיח.
          </Typography>
          {alerts.length === 0 ? (
            <Alert severity="success">אין התראות פתוחות.</Alert>
          ) : (
            alerts.map((a) => (
              <Alert key={a.id} severity={severityColor(a.severity)}>
                <Typography fontWeight={700}>
                  [{a.severity.toUpperCase()}] {a.title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {a.detail}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.75 }} color="text.secondary">
                  תיקון: {a.remediation}
                </Typography>
              </Alert>
            ))
          )}
        </Stack>
      ) : null}

      {tab === 2 && knowledge ? (
        <Stack spacing={2}>
          <Typography color="text.secondary">
            רול־אפ תפעולי של גרף הידע (Evidence · Claims · Memory · Decisions).
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Metric label="Claims" value={knowledge.claims} />
            <Metric label="Memories" value={knowledge.memories} />
            <Metric label="Decisions" value={knowledge.decisions} />
            <Metric label="Patches" value={knowledge.patches} />
            <Metric label="Agent runs" value={knowledge.agentRuns} />
            <Metric label="E2E היום" value={knowledge.processAuditsToday} />
            <Metric label="UNKNOWN epistemic" value={knowledge.epistemicUnknownProjects} />
          </Stack>
        </Stack>
      ) : null}

      {tab === 3 ? (
        <Stack spacing={2}>
          <Typography color="text.secondary">
            בדיקות קבועות מומלצות כל{" "}
            {wd?.automation.recommendedIntervalMinutes ?? 60} דקות. הריצו ידנית או
            חברו cron ל־POST /api/v1/admin/automation/run-checks.
          </Typography>
          <Metric
            label="Watchdog אחרון"
            value={wd?.automation.lastWatchdogAt ?? "מעולם לא"}
          />
          <Alert severity={wd?.automation.overdue ? "warning" : "success"}>
            {wd?.automation.overdue
              ? "הבדיקה באיחור — הפעילו אוטומציה עכשיו."
              : "לוח הזמנים תקין — הניטור מעודכן."}
          </Alert>
          <Button
            variant="contained"
            disabled={runChecks.isPending}
            onClick={() => runChecks.mutate()}
          >
            הרץ סבב תיקונים / ניטור
          </Button>
        </Stack>
      ) : null}

      {tab === 4 ? <HealthPanel /> : null}

      {tab === 5 ? <ApprovalQueuePanel /> : null}

      {tab === 6 ? <AgentLifecyclePanel /> : null}

      {tab === 7 ? <CostIntelligencePanel /> : null}
    </Stack>
  );
}
