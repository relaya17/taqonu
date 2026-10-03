"use client";

import { useRef, useState } from "react";
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface SentinelFinding {
  id: string;
  title: string;
  detail: string;
  severity: string;
  path?: string;
  remediation?: string;
  claim?: string;
  epistemicState?: string;
  redacted?: string;
  evidenceRefs?: string[];
}

interface SentinelScan {
  scannedAt: string;
  workspaceRoot: string;
  posture: string;
  summary: string;
  findings: SentinelFinding[];
  counts: {
    secrets: number;
    authz: number;
    dependencies: number;
    config: number;
    packs?: number;
    critical: number;
    high: number;
  };
  nextActions: string[];
  mode: string;
  agent: string;
}

function postureSeverity(
  posture: string,
): "success" | "info" | "warning" | "error" {
  if (posture === "NOT_RUN") return "info";
  if (posture === "CLEAR" || posture === "LOW") return "success";
  if (posture === "MEDIUM") return "warning";
  return "error";
}

/**
 * Security scan (secrets / authz / deps / config) — moved here from the old
 * standalone apps/web/app/[locale]/sentinel/page.tsx so it can live under
 * Studio's "Checks" tab, sharing Studio's own project picker instead of its
 * own. Same endpoints, same behavior.
 */
export function SentinelPanel({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("sentinel");
  const tx = useTranslations("sentinelExtras");
  const queryClient = useQueryClient();
  const [actionNote, setActionNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sarifFileName, setSarifFileName] = useState<string | null>(null);
  const [sarifDoc, setSarifDoc] = useState<Record<string, unknown> | null>(null);
  const [sarifParseError, setSarifParseError] = useState<string | null>(null);
  const [toolHint, setToolHint] = useState("");

  const uploadSarif = useMutation({
    mutationFn: () =>
      apiPost<{
        findingCount: number;
        evidenceIds: string[];
        note: string;
        epistemicState?: string;
      }>("/api/v1/security/sarif", {
        projectId,
        sarif: sarifDoc,
        ...(toolHint.trim() ? { toolHint: toolHint.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sentinel", projectId] });
    },
  });

  async function onSarifFile(file: File | undefined) {
    uploadSarif.reset();
    setSarifDoc(null);
    setSarifParseError(null);
    setSarifFileName(file?.name ?? null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setSarifParseError(tx("notObject"));
        return;
      }
      setSarifDoc(parsed as Record<string, unknown>);
    } catch {
      setSarifParseError(tx("invalidJson"));
    }
  }

  const state = useQuery({
    queryKey: ["sentinel", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiGet<SentinelScan>(`/api/v1/projects/${projectId}/sentinel`),
  });

  const scan = useMutation({
    mutationFn: () =>
      apiPost<SentinelScan>(`/api/v1/projects/${projectId}/sentinel/scan`, {}),
    onSuccess: () => {
      setActionNote(null);
      void queryClient.invalidateQueries({ queryKey: ["sentinel", projectId] });
    },
  });

  const propose = useMutation({
    mutationFn: (findingId: string) =>
      apiPost<{ note: string; loop: string }>(
        `/api/v1/projects/${projectId}/sentinel/propose`,
        { findingId },
      ),
    onSuccess: (data) => {
      setActionNote(`${data.loop} — ${data.note}`);
    },
  });

  const verify = useMutation({
    mutationFn: (findingId: string) =>
      apiPost<{ verified: boolean; note: string }>(
        `/api/v1/projects/${projectId}/sentinel/verify`,
        { findingId },
      ),
    onSuccess: (data) => {
      setActionNote(data.note);
      void queryClient.invalidateQueries({ queryKey: ["sentinel", projectId] });
    },
  });

  const result = scan.data ?? state.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920 }}>
      {!embedded ? (
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>
            {t("title")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t("subtitle")}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("subtitle")}
        </Typography>
      )}

      <Alert severity="info">{t("defensiveOnly")}</Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disabled={!projectId || scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? t("running") : t("run")}
        </Button>
      </Stack>

      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          {tx("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {tx("help")}
        </Typography>
        <input
          ref={fileInputRef}
          id="sentinel-sarif-file"
          type="file"
          accept=".sarif,.json,application/json,application/sarif+json"
          hidden
          onChange={(e) => {
            void onSarifFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }} alignItems={{ sm: "center" }}>
          <Button
            variant="outlined"
            disabled={!projectId}
            onClick={() => fileInputRef.current?.click()}
          >
            {tx("choose")}
          </Button>
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {sarifFileName ?? tx("noFile")}
          </Typography>
        </Stack>
        <TextField
          size="small"
          label={tx("toolHint")}
          helperText={tx("toolHintHelp")}
          value={toolHint}
          onChange={(e) => setToolHint(e.target.value)}
          inputProps={{ maxLength: 80 }}
          sx={{ mt: 1.5, maxWidth: 360 }}
          fullWidth
        />
        <Box sx={{ mt: 1.5 }}>
          <Button
            variant="contained"
            disabled={!projectId || !sarifDoc || uploadSarif.isPending}
            onClick={() => uploadSarif.mutate()}
          >
            {uploadSarif.isPending ? tx("uploading") : tx("upload")}
          </Button>
        </Box>
        {sarifParseError ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {sarifParseError}
          </Alert>
        ) : null}
        {uploadSarif.isError ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {uploadSarif.error instanceof Error ? uploadSarif.error.message : t("error")}
          </Alert>
        ) : null}
        {uploadSarif.data ? (
          <Alert severity={uploadSarif.data.findingCount > 0 ? "success" : "info"} sx={{ mt: 1.5 }}>
            {uploadSarif.data.findingCount > 0
              ? tx("uploaded", { count: uploadSarif.data.findingCount })
              : tx("noFindings")}
            {" — "}
            {uploadSarif.data.note}
          </Alert>
        ) : null}
      </Box>

      {scan.isError ? (
        <Alert severity="error">
          {scan.error instanceof Error ? scan.error.message : t("error")}
        </Alert>
      ) : null}

      {state.isError && !scan.data ? (
        <Alert severity="warning">
          {state.error instanceof Error ? state.error.message : t("error")}
        </Alert>
      ) : null}

      {actionNote ? <Alert severity="info">{actionNote}</Alert> : null}

      {result ? (
        <Stack spacing={2}>
          <Alert severity={postureSeverity(result.posture)}>
            {t("posture", { posture: result.posture })} — {result.summary}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {t("scannedAt", { at: result.scannedAt })} · {result.agent} · {result.mode}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={t("countSecrets", { n: result.counts.secrets })} />
            <Chip
              size="small"
              label={t("countAuthz", { n: result.counts.authz })}
              variant="outlined"
            />
            <Chip size="small" label={t("countDeps", { n: result.counts.dependencies ?? 0 })} />
            <Chip
              size="small"
              label={t("countConfig", { n: result.counts.config ?? 0 })}
              variant="outlined"
            />
            <Chip size="small" label={t("countPacks", { n: result.counts.packs ?? 0 })} />
            <Chip
              size="small"
              color={result.counts.critical > 0 ? "error" : "default"}
              label={t("countCritical", { n: result.counts.critical })}
            />
            <Chip
              size="small"
              color={result.counts.high > 0 ? "warning" : "default"}
              label={t("countHigh", { n: result.counts.high })}
              variant="outlined"
            />
          </Stack>

          <Stack spacing={1.5}>
            {result.findings.length === 0 ? (
              <Typography color="text.secondary">{t("clear")}</Typography>
            ) : (
              result.findings.map((f) => (
                <Box
                  key={f.id}
                  sx={{
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    pb: 1.25,
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={650}>{f.title}</Typography>
                    <Chip size="small" label={f.severity} color="warning" />
                    {f.claim ? <Chip size="small" label={f.claim} variant="outlined" /> : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {f.detail}
                  </Typography>
                  {f.path ? (
                    <Typography variant="caption" display="block">
                      {f.path}
                      {f.redacted ? ` · ${f.redacted}` : ""}
                    </Typography>
                  ) : null}
                  {f.remediation ? (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {t("remediation")}: {f.remediation}
                    </Typography>
                  ) : null}
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!projectId || propose.isPending}
                      onClick={() => propose.mutate(f.id)}
                    >
                      {t("propose")}
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      disabled={!projectId || verify.isPending}
                      onClick={() => verify.mutate(f.id)}
                    >
                      {t("verify")}
                    </Button>
                  </Stack>
                </Box>
              ))
            )}
          </Stack>

          {result.nextActions.length > 0 ? (
            <Box>
              <Typography variant="h6" component="h2" gutterBottom>
                {t("nextActions")}
              </Typography>
              <Stack spacing={0.5}>
                {result.nextActions.map((a) => (
                  <Typography key={a} variant="body2">
                    · {a}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
