"use client";

import { useState } from "react";
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface Finding {
  id: string;
  title: string;
  detail: string;
  claim: string;
  epistemicState: string;
  riskBand: string;
  category: string;
}

interface ObserveResult {
  id: string;
  workspaceRoot: string;
  previousGenomeAt: string | null;
  risk: { score: number; band: string; summary: string };
  findings: Finding[];
  bugs: { id: string; title: string; severity: string; status: string; claim: string }[];
  behaviorDiffs: { title: string; detail: string; riskBand: string }[];
  genome: { apis: { id: string; steps: { label: string }[] }[] };
}

/**
 * Runtime-observer / genome-diff check — moved here from the old standalone
 * apps/web/app/[locale]/observer/page.tsx so it can live under Studio's
 * "Checks" tab, sharing Studio's own project picker instead of its own.
 * Same endpoints, same behavior.
 */
export function ObserverPanel({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("observer");
  const queryClient = useQueryClient();
  const [bugTitle, setBugTitle] = useState("");

  const state = useQuery({
    queryKey: ["observer-state", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{
        genome: ObserveResult["genome"] | null;
        bugs: ObserveResult["bugs"];
        workspaceRoot: string;
      }>(`/api/v1/projects/${projectId}/observer`),
  });

  const cycle = useMutation({
    mutationFn: () =>
      apiPost<ObserveResult>(`/api/v1/projects/${projectId}/observe-cycle`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["observer-state", projectId] });
    },
  });

  const ingestBug = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/observer/bugs", {
        projectId,
        bugs: [{ title: bugTitle }],
      }),
    onSuccess: () => {
      setBugTitle("");
      void queryClient.invalidateQueries({ queryKey: ["observer-state", projectId] });
    },
  });

  const result = cycle.data;

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

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disabled={!projectId || cycle.isPending}
          onClick={() => cycle.mutate()}
        >
          {cycle.isPending ? t("running") : t("run")}
        </Button>
      </Stack>

      {cycle.isError ? (
        <Alert severity="error">
          {cycle.error instanceof Error ? cycle.error.message : t("error")}
        </Alert>
      ) : null}

      {result ? (
        <Stack spacing={2}>
          <Alert severity={result.risk.band === "LOW" ? "success" : "warning"}>
            {t("risk", { band: result.risk.band, score: result.risk.score })}
            {" — "}
            {result.risk.summary}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {result.previousGenomeAt
              ? t("comparedTo", { at: result.previousGenomeAt })
              : t("baseline")}
          </Typography>
          <Stack spacing={1}>
            {result.findings.map((f) => (
              <Box
                key={f.id}
                sx={{
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  pb: 1,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography fontWeight={650}>{f.title}</Typography>
                  <Chip size="small" label={f.claim} />
                  <Chip size="small" label={f.riskBand} variant="outlined" />
                  <Chip size="small" label={f.category} variant="outlined" />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {f.detail}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Stack>
      ) : null}

      <Box>
        <Typography variant="h6" component="h2" gutterBottom>
          {t("bugsTitle")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small"
            fullWidth
            label={t("bugTitle")}
            value={bugTitle}
            onChange={(e) => setBugTitle(e.target.value)}
          />
          <Button
            variant="outlined"
            disabled={!projectId || !bugTitle.trim() || ingestBug.isPending}
            onClick={() => ingestBug.mutate()}
          >
            {t("addBug")}
          </Button>
        </Stack>
        <Stack spacing={1}>
          {(result?.bugs ?? state.data?.bugs ?? []).map((b) => (
            <Stack key={b.id} direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={b.severity} />
              <Chip size="small" label={b.claim} variant="outlined" />
              <Typography variant="body2">{b.title}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
