"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

type SourceTab = "local" | "github" | "remote";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface ImportResult {
  source: string;
  project: { id: string; name: string; slug: string };
  workspaceRoot: string | null;
  analysis: {
    fileCount: number;
    apps?: string[];
    packages?: string[];
    graphHint?: string;
  } | null;
  analysisNote?: string | null;
  verdict: {
    status: string;
    productionReadiness: number;
    criticalBlockers: number;
    highRisks: number;
    unverifiedClaims: number;
  };
  cloudSynced?: boolean;
  storageNote?: string;
  note: string;
}

interface AuditSpineResult {
  projectId: string;
  projectName: string;
  projectSlug: string;
  workspaceRoot: string | null;
  auditSkipped: boolean;
  auditSkipReason: string | null;
  verdict: {
    status: string;
    productionReadiness: number;
    criticalBlockers: number;
    highRisks: number;
    unverifiedClaims: number;
    plainLanguageSummary: string;
    certificateId: string | null;
  };
  health: {
    reportId: string | null;
    overallScore: number | null;
    criticalIssues: number | null;
    highRisk: number | null;
    constitutionScore: number | null;
    plainLanguageSummary: string | null;
  };
  readiness: {
    certificateId: string | null;
    overallScore: number | null;
    blockers: string[];
    unknownClaims: number | null;
  };
  links: {
    verdict: string;
    health: string;
    readiness: string;
    projects: string;
  };
  checklistMarkdown: string;
  checklistJson: Record<string, unknown>;
  note: string;
}

export default function PartnersPage() {
  const t = useTranslations("partners");
  const [tab, setTab] = useState<SourceTab>("github");
  const [name, setName] = useState("Partner Repo");
  const [slug, setSlug] = useState("partner-repo");
  const [root, setRoot] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [syncCloud, setSyncCloud] = useState(false);
  const [spineProjectId, setSpineProjectId] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "md" | "json">("idle");

  const policy = useQuery({
    queryKey: ["storage-policy"],
    queryFn: () =>
      apiGet<{
        plainLanguage: string;
        freeCloudProjectSlots: number;
        atlasStores: string[];
        atlasDoesNotStore: string[];
        customerPaysProvidersFor: string[];
      }>("/api/v1/onboarding/storage-policy"),
  });

  const usage = useQuery({
    queryKey: ["usage-analytics"],
    queryFn: () =>
      apiGet<{
        projectsConnected: number;
        designPartnerSessions: number;
        verdictsRequested: number;
        certificatesIssued: number;
      }>("/api/v1/analytics/usage"),
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () =>
      apiGet<{
        github: { login: string | null; tokenConfigured: boolean } | null;
        local: { reposRoot: string | null } | null;
      }>("/api/v1/connections"),
    staleTime: 30_000,
  });

  const caseStudy = useQuery({
    queryKey: ["case-001"],
    queryFn: () =>
      apiGet<{
        title: string;
        narrative: string;
        filesAnalyzed: number;
        evidenceRecords: number;
        productionReadiness: number;
        verdictStatus: string;
        benchmarkPassRate: number | null;
        unauthorizedWrites: number;
      }>("/api/v1/case-studies/brokeros-001"),
  });

  useEffect(() => {
    if (spineProjectId) return;
    const items = projects.data?.items ?? [];
    if (items.length === 0) return;
    setSpineProjectId(items[0]?.id ?? "");
  }, [projects.data, spineProjectId]);

  const connect = useMutation({
    mutationFn: () => {
      if (tab === "local") {
        return apiPost<ImportResult>("/api/v1/onboarding/import", {
          source: "local",
          name,
          slug,
          workspaceRoot: root,
          syncEvidenceToCloud: syncCloud,
        });
      }
      if (tab === "github") {
        return apiPost<ImportResult>("/api/v1/onboarding/import", {
          source: "github",
          repo: githubRepo,
          name: name || undefined,
          slug: slug || undefined,
          token: githubToken.trim() || undefined,
          syncEvidenceToCloud: syncCloud,
        });
      }
      return apiPost<ImportResult>("/api/v1/onboarding/import", {
        source: "remote",
        repoUrl: remoteUrl,
        name,
        slug,
        syncEvidenceToCloud: syncCloud,
      });
    },
    onSuccess: (data) => {
      setSpineProjectId(data.project.id);
      void projects.refetch();
      void connections.refetch();
    },
  });

  const spine = useMutation({
    mutationFn: () =>
      apiPost<AuditSpineResult>("/api/v1/partners/audit-spine", {
        projectId: spineProjectId,
        includeConstitution: true,
        issueCertificate: true,
      }),
    onSuccess: () => {
      void usage.refetch();
    },
  });

  const canSubmit =
    tab === "local"
      ? Boolean(root)
      : tab === "github"
        ? Boolean(githubRepo)
        : Boolean(remoteUrl && name && slug);

  const copyChecklist = async (format: "md" | "json") => {
    const payload =
      format === "md"
        ? spine.data?.checklistMarkdown ?? ""
        : JSON.stringify(spine.data?.checklistJson ?? {}, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState(format);
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("idle");
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info">{t("offer")}</Alert>

      <Box sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}>
        <Typography fontWeight={700}>{t("modeTitle")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("modeNote")}
        </Typography>
        <Stack component="ul" spacing={0.5} sx={{ mt: 1.5, pl: 2, m: 0 }}>
          <Typography component="li" variant="body2">
            {t("modeStepImport")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("modeStepVerdict")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("modeStepHealth")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("modeStepCapture")}
          </Typography>
        </Stack>

        <Typography fontWeight={700} sx={{ mt: 2 }}>
          {t("spineTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("spineNote")}
        </Typography>
        <TextField
          select
          label={t("spineProject")}
          value={spineProjectId}
          onChange={(e) => setSpineProjectId(e.target.value)}
          helperText={t("spineProjectHelp")}
          sx={{ mt: 1.5, minWidth: 280 }}
          disabled={!projects.data?.items.length}
        >
          {(projects.data?.items ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
              {p.workspaceRoot ? "" : ` (${t("spineNoRoot")})`}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            disabled={!spineProjectId || spine.isPending}
            onClick={() => spine.mutate()}
          >
            {spine.isPending ? t("spineRunning") : t("spineRun")}
          </Button>
          <Button component={Link} href="/readiness" size="small" variant="outlined">
            {t("openReadiness")}
          </Button>
          <Button component={Link} href="/" size="small" variant="outlined">
            {t("openVerdict")}
          </Button>
          <Button component={Link} href="/health" size="small" variant="outlined">
            {t("openHealth")}
          </Button>
        </Stack>
        <Typography variant="caption" display="block" sx={{ mt: 1.5 }} color="text.secondary">
          {t("modeDocsHint")}
        </Typography>

        {spine.data ? (
          <Alert severity={spine.data.auditSkipped ? "warning" : "success"} sx={{ mt: 2 }}>
            <Typography variant="body2">{spine.data.note}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color="info"
                label={t("spineVerdictChip", {
                  status: spine.data.verdict.status,
                  score: spine.data.verdict.productionReadiness,
                })}
              />
              <Chip
                size="small"
                label={
                  spine.data.auditSkipped
                    ? t("spineHealthSkipped")
                    : t("spineHealthChip", {
                        score: spine.data.health.overallScore ?? "—",
                        constitution: spine.data.health.constitutionScore ?? "—",
                      })
                }
              />
              <Chip
                size="small"
                label={t("spineReadinessChip", {
                  score: spine.data.readiness.overallScore ?? "—",
                })}
              />
            </Stack>
            {spine.data.auditSkipReason ? (
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                {spine.data.auditSkipReason}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              <Button component={Link} href={spine.data.links.verdict} size="small">
                {t("openVerdict")}
              </Button>
              <Button component={Link} href={spine.data.links.health} size="small">
                {t("openHealth")}
              </Button>
              <Button component={Link} href={spine.data.links.readiness} size="small">
                {t("openReadiness")}
              </Button>
              <Button size="small" variant="outlined" onClick={() => void copyChecklist("md")}>
                {copyState === "md" ? t("spineCopied") : t("spineCopyMarkdown")}
              </Button>
              <Button size="small" variant="outlined" onClick={() => void copyChecklist("json")}>
                {copyState === "json" ? t("spineCopied") : t("spineCopyJson")}
              </Button>
            </Stack>
            <Box
              component="pre"
              sx={{
                mt: 1.5,
                p: 1.5,
                maxHeight: 220,
                overflow: "auto",
                bgcolor: "rgba(20,32,34,0.04)",
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {spine.data.checklistMarkdown}
            </Box>
          </Alert>
        ) : null}

        {spine.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(spine.error as Error).message}
          </Alert>
        ) : null}
      </Box>

      {policy.data ? (
        <Box sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}>
          <Typography fontWeight={700}>{t("storageTitle")}</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {policy.data.plainLanguage}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color="success"
              label={t("freeSlots", { n: policy.data.freeCloudProjectSlots })}
            />
            <Chip size="small" label={t("byoCode")} />
          </Stack>
        </Box>
      ) : null}

      {caseStudy.data ? (
        <Box sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}>
          <Typography fontWeight={700}>{caseStudy.data.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("labOnly")}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {caseStudy.data.narrative}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`Files ${caseStudy.data.filesAnalyzed}`} />
            <Chip size="small" label={`Evidence ${caseStudy.data.evidenceRecords}`} />
            <Chip
              size="small"
              color="info"
              label={`${caseStudy.data.verdictStatus} ${caseStudy.data.productionReadiness}`}
            />
          </Stack>
        </Box>
      ) : null}

      <Typography fontWeight={700}>{t("connectTitle")}</Typography>
      <Tabs
        value={tab}
        onChange={(_, v: SourceTab) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="github" label={t("tabGithub")} />
        <Tab value="remote" label={t("tabRemote")} />
        <Tab value="local" label={t("tabLocal")} />
      </Tabs>

      {tab !== "github" ? (
        <>
          <TextField
            label={t("name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label={t("slug")}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            helperText={t("slugHelp")}
          />
        </>
      ) : (
        <TextField
          label={t("nameOptional")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}

      {tab === "local" ? (
        <>
          <Alert severity="warning">{t("localCloudWarning")}</Alert>
          <TextField
            label={t("workspaceRoot")}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            helperText={t("workspaceHelp")}
            fullWidth
          />
        </>
      ) : null}

      {tab === "github" ? (
        <>
          <Alert severity="info">{t("githubPublicOk")}</Alert>
          {connections.data?.github?.tokenConfigured ? (
            <Alert severity="success">
              {t("patConnected", {
                login: connections.data.github.login ?? "GitHub",
              })}
            </Alert>
          ) : (
            <Alert severity="warning">{t("patMissing")}</Alert>
          )}
          <TextField
            label={t("githubRepo")}
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            helperText={t("githubHelp")}
            fullWidth
            placeholder="owner/repo"
          />
          <TextField
            label={t("githubToken")}
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            helperText={t("githubTokenHelp")}
            fullWidth
            autoComplete="off"
          />
        </>
      ) : null}

      {tab === "remote" ? (
        <TextField
          label={t("remoteUrl")}
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          helperText={t("remoteHelp")}
          fullWidth
        />
      ) : null}

      <FormControlLabel
        control={
          <Switch
            checked={syncCloud}
            onChange={(_, v) => setSyncCloud(v)}
          />
        }
        label={t("syncCloud")}
      />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          disabled={connect.isPending || !canSubmit}
          onClick={() => connect.mutate()}
        >
          {t("connect")}
        </Button>
        <Button component={Link} href="/integrations" variant="outlined">
          {t("openIntegrations")}
        </Button>
      </Stack>

      {connect.data ? (
        <Alert severity="success">
          {connect.data.note}
          {connect.data.storageNote ? (
            <Box sx={{ mt: 1 }}>{connect.data.storageNote}</Box>
          ) : null}
          <Box sx={{ mt: 1 }}>
            {connect.data.project.name} · {connect.data.verdict.status} ·{" "}
            {connect.data.verdict.productionReadiness}/100
            {connect.data.analysis
              ? ` · files ${connect.data.analysis.fileCount}`
              : ""}
            {connect.data.analysis?.apps?.length
              ? ` · apps ${connect.data.analysis.apps.join(", ")}`
              : ""}
            {connect.data.analysis?.packages?.length
              ? ` · packages ${connect.data.analysis.packages.slice(0, 6).join(", ")}`
              : ""}
            {connect.data.cloudSynced ? " · cloud evidence synced" : ""}
          </Box>
          {connect.data.analysisNote ? (
            <Box sx={{ mt: 1 }} color="text.secondary">
              {connect.data.analysisNote}
            </Box>
          ) : null}
          <Button
            size="small"
            sx={{ mt: 1, mr: 1 }}
            variant="contained"
            onClick={() => {
              setSpineProjectId(connect.data.project.id);
              spine.mutate();
            }}
            disabled={spine.isPending}
          >
            {t("spineRun")}
          </Button>
          <Button component={Link} href="/readiness" size="small" sx={{ mt: 1, mr: 1 }}>
            {t("openReadiness")}
          </Button>
          <Button component={Link} href="/" size="small" sx={{ mt: 1 }}>
            {t("openVerdict")}
          </Button>
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            {t("nextLocalHint")}
          </Typography>
        </Alert>
      ) : null}

      {connect.isError ? (
        <Alert severity="error">{(connect.error as Error).message}</Alert>
      ) : null}

      {usage.data ? (
        <Typography variant="body2" color="text.secondary">
          {t("usage", {
            projects: usage.data.projectsConnected,
            sessions: usage.data.designPartnerSessions,
            verdicts: usage.data.verdictsRequested,
            certs: usage.data.certificatesIssued,
          })}
        </Typography>
      ) : null}
    </Stack>
  );
}
