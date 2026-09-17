"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { API_URL, apiGet, apiPost } from "@/lib/api";
import { OnboardingPath } from "@/components/onboarding/OnboardingPath";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";

interface Project {
  id: string;
  name: string;
  workspaceRoot?: string | null;
}

/**
 * Mirrors packages/shared/src/schemas/process-audit.schema.ts's
 * processAuditItemSchema. `sections.blockers`/`defects` (below) are a
 * flattened `[SEVERITY] title` string per item -- convenient for a quick
 * list, but they drop `epistemicState`/`expected`/`actual`, which is
 * exactly the distinction between "we proved this fails" and "we could not
 * find evidence it was tested" (ADR-014: "never silently merge
 * categories"). Render blockers/defects from `items` instead of
 * `sections` so that distinction reaches the screen.
 */
interface ProcessAuditItem {
  id: string;
  kind: "BLOCKER" | "DEFECT" | "FUTURE_CHECK" | "RECOMMENDATION" | string;
  severity: string;
  title: string;
  detail: string;
  expected: string | null;
  actual: string | null;
  epistemicState: string;
  recommendedNext: string | null;
}

interface ProcessAuditDocument {
  id: string;
  appProfile: string;
  appProfileSource: string;
  verdict: "GO" | "CONDITIONAL_GO" | "NO_GO";
  verdictReason: string;
  specialistsEngaged: string[];
  items: ProcessAuditItem[];
  sections: {
    executiveSummary: string;
    defects: string[];
    blockers: string[];
    futureChecks: string[];
    recommendations: string[];
  };
  markdownReport: string;
  syncedMemoryId?: string;
  note?: string;
}

/** Short, plain-language gloss for each epistemicState value this audit actually emits. */
const EPISTEMIC_STATE_KEYS: Record<string, string> = {
  OBSERVED: "epistemic_OBSERVED",
  INFERRED: "epistemic_INFERRED",
  PROPOSED: "epistemic_PROPOSED",
  UNKNOWN: "epistemic_UNKNOWN",
};

interface Reachability {
  overall: "READY" | "PARTIAL" | "BLOCKED";
  local: { path: string | null; reachable: boolean; note: string };
  repo: { cloudSynced: boolean; note: string };
  canOpenFiles: boolean;
}

interface CentralOpinion {
  verdict: string;
  executiveOpinion: string;
  findings: Array<{ severity: string; title: string; source: string }>;
  memoryReminders: string[];
  markdown: string;
}

interface RemindersResponse {
  reminders: string[];
  reachability: Reachability;
}

const APP_PROFILES = [
  "AUTO",
  "GENERIC",
  "SAAS",
  "ECOMMERCE",
  "MARKETPLACE",
  "CONTENT",
  "FINTECH",
  "HEALTH",
  "EDTECH",
  "HOTEL",
] as const;

export function ProcessAuditPanel({
  projectId: boundProjectId,
  embedded = false,
}: {
  projectId?: string | undefined;
  embedded?: boolean;
}) {
  const t = useTranslations("processAudit");
  const [projectId, setProjectId] = useState(boundProjectId ?? "");
  const [appProfile, setAppProfile] =
    useState<(typeof APP_PROFILES)[number]>("AUTO");
  const [request, setRequest] = useState("");
  const [doc, setDoc] = useState<ProcessAuditDocument | null>(null);
  const [opinion, setOpinion] = useState<CentralOpinion | null>(null);

  useEffect(() => {
    if (boundProjectId) setProjectId(boundProjectId);
  }, [boundProjectId]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );
  const selected = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const reachabilityQuery = useQuery({
    queryKey: ["project-reachability", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<Reachability>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/reachability`,
      ),
  });

  const remindersQuery = useQuery({
    queryKey: ["manager-reminders", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<RemindersResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/manager-reminders`,
      ),
  });

  const run = useMutation({
    mutationFn: () =>
      apiPost<ProcessAuditDocument>("/api/v1/qa/process-audit", {
        projectId: projectId || null,
        appProfile: appProfile === "AUTO" ? null : appProfile,
        userRequest: request || t("defaultRequest"),
        environment: "LOCAL",
        includeProviders: true,
        includeUiUx: true,
        includePerformance: true,
      }),
    onSuccess: (data) => {
      setDoc(data);
      void remindersQuery.refetch();
      void reachabilityQuery.refetch();
    },
  });

  const central = useMutation({
    mutationFn: () =>
      apiGet<CentralOpinion>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/central-opinion`,
      ),
    onSuccess: setOpinion,
  });

  const openPdf = () => {
    if (!projectId) return;
    window.open(
      `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/central-opinion.pdf`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const openHtmlPdf = () => {
    if (!projectId) return;
    window.open(
      `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/central-opinion.html`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const reach = reachabilityQuery.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 720, width: "100%", minWidth: 0, mx: "auto", textAlign: "center" }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", md: "2.25rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info">{t("intro")}</Alert>
      <Alert severity="success">{t("partnerNote")}</Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="center">
        <TextField
          select
          label={t("project")}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setDoc(null);
            setOpinion(null);
          }}
          sx={{ minWidth: 220, flex: 1 }}
          {...(projects.length === 0 ? { helperText: t("noProjects") } : {})}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
              {p.workspaceRoot ? "" : ` (${t("noLocal")})`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t("appProfile")}
          value={appProfile}
          onChange={(e) =>
            setAppProfile(e.target.value as (typeof APP_PROFILES)[number])
          }
          sx={{ minWidth: 180 }}
          helperText={t("appProfileHelp")}
        >
          {APP_PROFILES.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selected?.workspaceRoot}
          compact
        />
      ) : null}

      {reach ? (
        <Alert
          severity={
            reach.overall === "READY"
              ? "success"
              : reach.overall === "PARTIAL"
                ? "warning"
                : "error"
          }
        >
          <Typography fontWeight={700}>
            {t("reachability")}: {reach.overall}
          </Typography>
          <Typography variant="body2">
            {t("localPath")}:{" "}
            {reach.local.reachable ? "OK" : "—"} {reach.local.path ?? ""}
          </Typography>
          <Typography variant="body2">{reach.local.note}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t("repoLink")}: {reach.repo.cloudSynced ? "OK" : "—"} —{" "}
            {reach.repo.note}
          </Typography>
        </Alert>
      ) : null}

      {selected && !selected.workspaceRoot ? (
        <OnboardingPath missingRootCount={1} />
      ) : null}

      <TextField
        multiline
        minRows={2}
        fullWidth
        label={t("request")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={t("placeholder")}
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap">
        <Button
          variant="contained"
          onClick={() => run.mutate()}
          disabled={run.isPending || !projectId}
        >
          {run.isPending ? t("running") : t("run")}
        </Button>
        <Button
          variant="outlined"
          disabled={!projectId || central.isPending}
          onClick={() => central.mutate()}
        >
          {t("centralOpinion")}
        </Button>
        <Button variant="outlined" disabled={!projectId} onClick={openPdf}>
          {t("downloadPdf")}
        </Button>
        <Button variant="outlined" disabled={!projectId} onClick={openHtmlPdf}>
          {t("printPdf")}
        </Button>
      </Stack>

      {run.isError ? (
        <Alert severity="error">{(run.error as Error).message}</Alert>
      ) : null}
      {central.isError ? (
        <Alert severity="error">{(central.error as Error).message}</Alert>
      ) : null}

      {remindersQuery.data?.reminders?.length ? (
        <Box>
          <Typography variant="overline">{t("reminders")}</Typography>
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {remindersQuery.data.reminders.slice(0, 8).map((r) => (
              <Typography key={r} variant="body2">
                • {r}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}

      {doc ? (
        <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2.5 }}>
          <Typography variant="overline">{t("result")}</Typography>
          <Alert
            severity={
              doc.verdict === "GO"
                ? "success"
                : doc.verdict === "CONDITIONAL_GO"
                  ? "warning"
                  : "error"
            }
            sx={{ mt: 1, mb: 2 }}
          >
            <Typography fontWeight={700}>
              {t(`verdict_${doc.verdict}`)}
            </Typography>
            <Typography variant="body2">{doc.verdictReason}</Typography>
            {doc.syncedMemoryId ? (
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                {t("syncedMemory")}
              </Typography>
            ) : null}
          </Alert>

          {(["BLOCKER", "DEFECT"] as const).map((kind) => {
            const rows = (doc.items ?? []).filter((i) => i.kind === kind);
            if (rows.length === 0) return null;
            return (
              <Box key={kind} sx={{ mb: 2 }}>
                <Typography variant="overline">
                  {t(kind === "BLOCKER" ? "blockers" : "defects")}
                </Typography>
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  {rows.map((item) => (
                    <Box key={item.id}>
                      <Typography variant="body2">
                        • [{item.severity}] {item.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", ml: 2 }}
                      >
                        {t("evidenceState")}:{" "}
                        {t(
                          EPISTEMIC_STATE_KEYS[item.epistemicState] ??
                            "epistemic_UNKNOWN",
                        )}
                        {item.actual ? ` — ${t("actualLabel")}: ${item.actual}` : ""}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            );
          })}

          {doc.sections.recommendations.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline">{t("recommendations")}</Typography>
              {doc.sections.recommendations.map((r) => (
                <Typography key={r} variant="body2">
                  • {r}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {opinion ? (
        <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2.5 }}>
          <Typography variant="overline">{t("centralResult")}</Typography>
          <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
            <Typography fontWeight={700}>
              {opinion.verdict}
            </Typography>
            <Typography variant="body2">{opinion.executiveOpinion}</Typography>
          </Alert>
          {opinion.findings.slice(0, 12).map((f) => (
            <Typography key={`${f.source}-${f.title}`} variant="body2">
              • [{f.severity}] {f.title}
            </Typography>
          ))}
          <Button
            size="small"
            sx={{ mt: 1.5 }}
            variant="outlined"
            onClick={async () => {
              await navigator.clipboard.writeText(opinion.markdown);
            }}
          >
            {t("copyReport")}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
