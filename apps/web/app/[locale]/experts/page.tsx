"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface StyleLane {
  id: string;
  titleEn: string;
  titleHe: string;
  titleAr: string;
  focus: string;
}

interface ExpertItem {
  id: string;
  titleHe: string;
  titleEn: string;
  titleAr: string;
  focus: string;
  checklist: string[];
  domain?: string;
  requiredEvidence?: string[];
  forbiddenAssumptions?: string[];
  evaluationCriteria?: string[];
  fabricAgentIds?: string[];
  styleLanes?: StyleLane[];
  budgetHintEn?: string;
  budgetHintHe?: string;
  budgetHintAr?: string;
}

interface Project {
  id: string;
  name: string;
}

interface ExpertReview {
  id: string;
  expertId: string;
  summary: string;
  findings: Array<{
    id: string;
    checklistItem: string;
    status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
    severity: string;
    note: string;
    epistemicState: string;
  }>;
  recommendations: string[];
  statusCounts: {
    PASS: number;
    WARN: number;
    FAIL: number;
    UNKNOWN: number;
  };
  epistemicState: "INFERRED" | "UNKNOWN";
}

interface EditorBrief {
  id: string;
  markdown: string;
  experts: string[];
  editorHint: string;
}

function expertTitle(expert: ExpertItem, locale: string): string {
  if (locale === "he") return expert.titleHe;
  if (locale === "ar") return expert.titleAr;
  return expert.titleEn;
}

function laneTitle(lane: StyleLane, locale: string): string {
  if (locale === "he") return lane.titleHe;
  if (locale === "ar") return lane.titleAr;
  return lane.titleEn;
}

function budgetOf(expert: ExpertItem, locale: string): string {
  if (locale === "he") return expert.budgetHintHe ?? "";
  if (locale === "ar") return expert.budgetHintAr ?? "";
  return expert.budgetHintEn ?? "";
}

export default function ExpertsPage() {
  const t = useTranslations("experts");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const expertFromUrl = searchParams.get("expert");

  const [selectedExpert, setSelectedExpert] = useState<string>("UI_UX");
  const [styleLaneId, setStyleLaneId] = useState<string>("");
  const [projectId, setProjectId] = useState("");
  const [request, setRequest] = useState("");
  const [review, setReview] = useState<ExpertReview | null>(null);
  const [brief, setBrief] = useState<EditorBrief | null>(null);
  const [copied, setCopied] = useState(false);

  const expertsQuery = useQuery({
    queryKey: ["experts"],
    queryFn: () => apiGet<{ items: ExpertItem[] }>("/api/v1/experts"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const items = expertsQuery.data?.items ?? [];
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  useEffect(() => {
    if (!expertFromUrl) return;
    if (items.some((item) => item.id === expertFromUrl)) {
      setSelectedExpert(expertFromUrl);
      setReview(null);
      setStyleLaneId("");
    }
  }, [expertFromUrl, items]);

  const active = items.find((item) => item.id === selectedExpert) ?? items[0];
  const styleLanes = active?.styleLanes ?? [];

  const composedRequest = useMemo(() => {
    const base = request.trim();
    if (!styleLaneId || !active) return base;
    const lane = styleLanes.find((l) => l.id === styleLaneId);
    if (!lane) return base;
    return `[${laneTitle(lane, locale)} · ${lane.focus}]\n${base}`;
  }, [request, styleLaneId, active, styleLanes, locale]);

  const reviewMutation = useMutation({
    mutationFn: () =>
      apiPost<ExpertReview>("/api/v1/experts/review", {
        expertId: selectedExpert,
        projectId: projectId || null,
        userRequest: composedRequest,
      }),
    onSuccess: (data) => {
      setReview(data);
      setBrief(null);
    },
  });

  const briefMutation = useMutation({
    mutationFn: () =>
      apiPost<EditorBrief>("/api/v1/editor/brief", {
        userRequest: composedRequest,
        projectId: projectId || null,
        experts: [selectedExpert],
        includeState: true,
        includeDecisions: true,
        includeQaHints: selectedExpert === "QA",
      }),
    onSuccess: (data) => {
      setBrief(data);
      setCopied(false);
    },
  });

  const copyBrief = async () => {
    if (!brief) return;
    await navigator.clipboard.writeText(brief.markdown);
    setCopied(true);
  };

  const primaryFabric = active?.fabricAgentIds?.[0];

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("consultHelp")}{" "}
          <Link href="/agents">{t("openAgents")}</Link>
        </Alert>
      </Box>

      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        spacing={1}
        sx={{ gap: 1 }}
      >
        {items.map((expert) => {
          const selected = expert.id === selectedExpert;
          return (
            <Chip
              key={expert.id}
              clickable
              color={selected ? "primary" : "default"}
              variant={selected ? "filled" : "outlined"}
              label={expertTitle(expert, locale)}
              component={Link}
              href={`/experts?expert=${expert.id}`}
              sx={{ fontWeight: selected ? 700 : 500 }}
            />
          );
        })}
      </Stack>

      {active ? (
        <Box
          sx={{
            py: 1.5,
            borderBottom: "1px solid rgba(26,31,42,0.12)",
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", md: "1.4fr 1fr" },
          }}
        >
          <Box>
            <Typography fontWeight={700}>
              {expertTitle(active, locale)} · {active.titleEn}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {active.focus}
            </Typography>
            {budgetOf(active, locale) ? (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t("budget")}: {budgetOf(active, locale)}
              </Typography>
            ) : null}
            <Typography variant="overline" sx={{ display: "block", mt: 1.5 }}>
              {t("evidencePolicy")}
            </Typography>
            <Typography variant="body2">
              {(active.requiredEvidence ?? []).join(" · ") || "—"}
            </Typography>
            <Typography variant="overline" sx={{ display: "block", mt: 1 }}>
              {t("forbiddenAssumptions")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {(active.forbiddenAssumptions ?? []).join(" · ") || "—"}
            </Typography>
            <Typography variant="overline" sx={{ display: "block", mt: 1 }}>
              {t("checklist")}
            </Typography>
            <Typography variant="body2">
              {active.checklist.slice(0, 6).join(" · ")}
              {active.checklist.length > 6 ? "…" : ""}
            </Typography>
          </Box>
          <Box>
            <Typography variant="overline">{t("fabricRoles")}</Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mt: 0.5, gap: 0.75 }}>
              {(active.fabricAgentIds ?? []).map((id) => (
                <Chip
                  key={id}
                  size="small"
                  clickable
                  component={Link}
                  href={`/agents?agent=${id}`}
                  label={id}
                  variant="outlined"
                />
              ))}
            </Stack>
            {primaryFabric ? (
              <Button
                component={Link}
                href={`/agents?agent=${primaryFabric}`}
                size="small"
                sx={{ mt: 1.5 }}
              >
                {t("planDispatch")}
              </Button>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {styleLanes.length > 0 ? (
        <Box>
          <Typography variant="overline">{t("styleLanes")}</Typography>
          <Stack
            direction="row"
            flexWrap="wrap"
            useFlexGap
            spacing={1}
            sx={{ mt: 0.75, gap: 1 }}
          >
            {styleLanes.map((lane) => {
              const selected = styleLaneId === lane.id;
              return (
                <Chip
                  key={lane.id}
                  clickable
                  color={selected ? "secondary" : "default"}
                  variant={selected ? "filled" : "outlined"}
                  label={laneTitle(lane, locale)}
                  onClick={() =>
                    setStyleLaneId((prev) => (prev === lane.id ? "" : lane.id))
                  }
                />
              );
            })}
          </Stack>
          {styleLaneId ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {styleLanes.find((l) => l.id === styleLaneId)?.focus}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("styleLanesHelp")}
            </Typography>
          )}
        </Box>
      ) : null}

      <TextField
        select
        label={t("project")}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        helperText={t("projectHelper")}
      >
        <MenuItem value="">{t("anyProject")}</MenuItem>
        {projects.map((project) => (
          <MenuItem key={project.id} value={project.id}>
            {project.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        multiline
        minRows={3}
        fullWidth
        label={t("checkRequest")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={t("placeholder")}
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          disabled={reviewMutation.isPending || request.trim().length < 3}
          onClick={() => reviewMutation.mutate()}
        >
          {t("runReview")}
        </Button>
        <Button
          variant="outlined"
          disabled={briefMutation.isPending || request.trim().length < 3}
          onClick={() => briefMutation.mutate()}
        >
          {t("createBrief")}
        </Button>
        {brief ? (
          <Button variant="outlined" onClick={() => void copyBrief()}>
            {copied ? t("copied") : t("copyBrief")}
          </Button>
        ) : null}
      </Stack>

      {reviewMutation.isError ? (
        <Alert severity="error">{(reviewMutation.error as Error).message}</Alert>
      ) : null}

      {review ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h2" sx={{ fontSize: "1.35rem" }}>
              {t("results")}
            </Typography>
            <EpistemicChip state={review.epistemicState} />
          </Stack>
          <Typography>{review.summary}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("counts", {
              warn: review.statusCounts.WARN,
              fail: review.statusCounts.FAIL,
              unknown: review.statusCounts.UNKNOWN,
              pass: review.statusCounts.PASS,
            })}
          </Typography>

          <Stack spacing={0}>
            {review.findings.map((finding) => (
              <Box
                key={finding.id}
                sx={{
                  py: 1.5,
                  borderBottom: "1px solid rgba(26,31,42,0.1)",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={finding.status} />
                  <Typography fontWeight={650}>{finding.checklistItem}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {finding.note}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Box>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              {t("recommendations")}
            </Typography>
            {review.recommendations.map((item) => (
              <Typography key={item} variant="body2" sx={{ mb: 0.5 }}>
                • {item}
              </Typography>
            ))}
          </Box>
        </Stack>
      ) : null}

      {brief ? (
        <Box>
          <Typography variant="h2" sx={{ fontSize: "1.2rem", mb: 1 }}>
            {t("briefTitle")}
          </Typography>
          <Box
            component="pre"
            sx={{
              p: 2,
              bgcolor: "rgba(26,31,42,0.04)",
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
              overflow: "auto",
              maxHeight: 360,
            }}
          >
            {brief.markdown}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}
