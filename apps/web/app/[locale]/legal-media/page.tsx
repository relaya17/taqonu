"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";
import type { EpistemicState } from "@atlas/shared";

interface Project {
  id: string;
  name: string;
}

interface Finding {
  id: string;
  area: string;
  status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  severity: string;
  title: string;
  note: string;
  fixHint: string;
  epistemicState: EpistemicState;
}

interface Source {
  id: string;
  titleEn: string;
  titleHe: string;
  url: string;
  kind: string;
  region: string;
}

interface Review {
  lawyerReadiness: "READY_FOR_COUNSEL" | "NEEDS_FIXES" | "INSUFFICIENT_EVIDENCE";
  summaryEn: string;
  summaryHe: string;
  disclaimerEn: string;
  disclaimerHe: string;
  disclaimerAr: string;
  findings: Finding[];
  counselTopics: string[];
  verifiedSources: Source[];
  epistemicState: EpistemicState;
  notALawyer: true;
}

export default function LegalMediaPage() {
  const t = useTranslations("legalMedia");
  const locale = useLocale();
  const [projectId, setProjectId] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const sources = useQuery({
    queryKey: ["legal-media-sources"],
    queryFn: () => apiGet<{ items: Source[] }>("/api/v1/legal-media/sources"),
  });

  const review = useMutation({
    mutationFn: () =>
      apiPost<Review>("/api/v1/legal-media/review", {
        projectId: projectId || null,
      }),
  });

  const data = review.data;
  const disclaimer =
    locale === "he"
      ? data?.disclaimerHe
      : locale === "ar"
        ? data?.disclaimerAr
        : data?.disclaimerEn;
  const summary =
    locale === "he" ? data?.summaryHe : data?.summaryEn;

  return (
    <Stack spacing={3} sx={{ maxWidth: 880 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Alert severity="warning">{t("disclaimer")}</Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          select
          fullWidth
          label={t("project")}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          helperText={t("projectHelp")}
        >
          <MenuItem value="">{t("pickProject")}</MenuItem>
          {(projects.data?.items ?? []).map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          disabled={review.isPending}
          onClick={() => review.mutate()}
          sx={{ whiteSpace: "nowrap", alignSelf: { sm: "center" } }}
        >
          {t("run")}
        </Button>
      </Stack>

      {review.isError ? (
        <Alert severity="error">{(review.error as Error).message}</Alert>
      ) : null}

      {data ? (
        <Stack spacing={2}>
          <Alert severity="info">{disclaimer}</Alert>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              label={t(`readiness_${data.lawyerReadiness}` as "readiness_NEEDS_FIXES")}
              color={
                data.lawyerReadiness === "READY_FOR_COUNSEL"
                  ? "success"
                  : data.lawyerReadiness === "NEEDS_FIXES"
                    ? "warning"
                    : "default"
              }
            />
            <EpistemicChip state={data.epistemicState} />
            <Chip size="small" label={t("notLawyerChip")} variant="outlined" />
          </Stack>
          <Typography>{summary}</Typography>

          <Typography fontWeight={650}>{t("findings")}</Typography>
          <Stack spacing={1.5}>
            {data.findings.map((f) => (
              <Box
                key={f.id}
                sx={{ borderBottom: "1px solid rgba(20,32,34,0.1)", pb: 1.5 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography fontWeight={600}>{f.title}</Typography>
                  <Chip size="small" label={f.status} />
                  <Chip size="small" label={f.severity} variant="outlined" />
                  <EpistemicChip state={f.epistemicState} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {f.note}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {t("fixHint")}: {f.fixHint}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Typography fontWeight={650}>{t("counselTopics")}</Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {data.counselTopics.map((topic) => (
              <Typography component="li" key={topic} variant="body2">
                {topic}
              </Typography>
            ))}
          </Stack>
        </Stack>
      ) : null}

      <Box>
        <Typography fontWeight={650} sx={{ mb: 1 }}>
          {t("sourcesTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("sourcesHelp")}
        </Typography>
        <Stack spacing={0.75}>
          {(sources.data?.items ?? data?.verifiedSources ?? []).map((s) => (
            <Typography key={s.id} variant="body2">
              <MuiLink href={s.url} target="_blank" rel="noopener noreferrer">
                {locale === "he" ? s.titleHe : s.titleEn}
              </MuiLink>
              {` · ${s.kind} · ${s.region}`}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
