"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
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

interface ImportResult {
  source: string;
  project: { id: string; name: string; slug: string };
  workspaceRoot: string | null;
  analysis: { fileCount: number } | null;
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

export default function PartnersPage() {
  const t = useTranslations("partners");
  const [tab, setTab] = useState<SourceTab>("local");
  const [name, setName] = useState("Partner Repo");
  const [slug, setSlug] = useState("partner-repo");
  const [root, setRoot] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [syncCloud, setSyncCloud] = useState(false);

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
  });

  const canSubmit =
    tab === "local"
      ? Boolean(root)
      : tab === "github"
        ? Boolean(githubRepo)
        : Boolean(remoteUrl && name && slug);

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="info">{t("offer")}</Alert>

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
        <Tab value="local" label={t("tabLocal")} />
        <Tab value="github" label={t("tabGithub")} />
        <Tab value="remote" label={t("tabRemote")} />
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
        <TextField
          label={t("workspaceRoot")}
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          helperText={t("workspaceHelp")}
          fullWidth
        />
      ) : null}

      {tab === "github" ? (
        <TextField
          label={t("githubRepo")}
          value={githubRepo}
          onChange={(e) => setGithubRepo(e.target.value)}
          helperText={t("githubHelp")}
          fullWidth
        />
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
            {connect.data.cloudSynced ? " · cloud evidence synced" : ""}
          </Box>
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
