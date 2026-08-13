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
import { apiGet, apiPost, downloadVerifiedSourcesPack } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface FabricAgent {
  id: string;
  title: string;
  titleHe?: string;
  titleAr?: string;
  specialty: string;
  category?: string;
  allowedTools: string[];
  forbiddenTools: string[];
  evidenceRequirements: string[];
  maxCostUsd: number;
  timeoutMs: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  canWriteCode: boolean;
  costHintEn?: string;
  costHintHe?: string;
  costHintAr?: string;
  strengthsEn?: string[];
  strengthsHe?: string[];
  strengthsAr?: string[];
  weaknessesEn?: string[];
  weaknessesHe?: string[];
  weaknessesAr?: string[];
  trustLevel?: string;
}

interface Project {
  id: string;
  name: string;
}

interface AgentPlan {
  id: string;
  steps: Array<{
    agentId: string;
    rationale: string;
    requiredEvidence: string[];
    estimatedCostUsd: number;
  }>;
  routerHints: string[];
  estimatedTotalCostUsd: number;
  epistemicState: string;
}

interface AgentDispatch {
  id: string;
  plan: AgentPlan;
  runs: Array<{
    agentId: string;
    status: string;
    summary: string;
    claims: string[];
    evidenceRefs: string[];
    epistemicState: string;
    costUsd: number;
  }>;
  judge: {
    decision: string;
    confidence: number;
    rationale: string;
    contradictions: string[];
    unsupportedClaims: string[];
    missingEvidence: string[];
    epistemicState: string;
  } | null;
  traceId: string;
}

const CATEGORIES = [
  "all",
  "orchestration",
  "engineering",
  "quality",
  "security",
  "design",
  "ops",
  "research",
  "governance",
] as const;

function pickLocale<T>(locale: string, en: T, he: T, ar: T): T {
  if (locale === "he") return he;
  if (locale === "ar") return ar;
  return en;
}

export default function AgentsPage() {
  const t = useTranslations("agents");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const agentFromUrl = searchParams.get("agent");

  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]>("all");
  const [selectedId, setSelectedId] = useState<string>("UI_UX");
  const [projectId, setProjectId] = useState("");
  const [request, setRequest] = useState("");
  const [budgetUsd, setBudgetUsd] = useState(2);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [dispatch, setDispatch] = useState<AgentDispatch | null>(null);

  const agentsQuery = useQuery({
    queryKey: ["fabric-agents"],
    queryFn: () =>
      apiGet<{ items: FabricAgent[]; note?: string }>("/api/v1/agents"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const verifiedSourcesQuery = useQuery({
    queryKey: ["verified-tech-sources"],
    queryFn: () =>
      apiGet<{
        domains: string[];
        items: Array<{
          id: string;
          domain: string;
          titleEn: string;
          titleHe: string;
          url: string;
          kind: string;
        }>;
        note: string;
      }>("/api/v1/knowledge/verified-sources"),
    staleTime: 10 * 60_000,
  });

  const items = agentsQuery.data?.items ?? [];
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const filtered = useMemo(() => {
    if (category === "all") return items;
    return items.filter((a) => a.category === category);
  }, [items, category]);

  useEffect(() => {
    if (!agentFromUrl) return;
    if (items.some((a) => a.id === agentFromUrl)) {
      setSelectedId(agentFromUrl);
      setPlan(null);
      setDispatch(null);
    }
  }, [agentFromUrl, items]);

  const active =
    filtered.find((a) => a.id === selectedId) ??
    items.find((a) => a.id === selectedId) ??
    filtered[0] ??
    items[0];

  useEffect(() => {
    if (active && active.id !== selectedId) {
      setSelectedId(active.id);
    }
  }, [active, selectedId]);

  const titleOf = (a: FabricAgent) =>
    pickLocale(locale, a.title, a.titleHe ?? a.title, a.titleAr ?? a.title);

  const costOf = (a: FabricAgent) =>
    pickLocale(
      locale,
      a.costHintEn ?? `≤ $${a.maxCostUsd}`,
      a.costHintHe ?? `≤ $${a.maxCostUsd}`,
      a.costHintAr ?? `≤ $${a.maxCostUsd}`,
    );

  const strengthsOf = (a: FabricAgent) =>
    pickLocale(
      locale,
      a.strengthsEn ?? [],
      a.strengthsHe ?? a.strengthsEn ?? [],
      a.strengthsAr ?? a.strengthsEn ?? [],
    );

  const weaknessesOf = (a: FabricAgent) =>
    pickLocale(
      locale,
      a.weaknessesEn ?? [],
      a.weaknessesHe ?? a.weaknessesEn ?? [],
      a.weaknessesAr ?? a.weaknessesEn ?? [],
    );

  const planMutation = useMutation({
    mutationFn: () =>
      apiPost<AgentPlan>("/api/v1/agents/plan", {
        request: request.trim(),
        projectId: projectId || null,
        agentIds: active ? [active.id] : undefined,
        budgetUsd,
        maxAgents: 4,
      }),
    onSuccess: (data) => {
      setPlan(data);
      setDispatch(null);
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      apiPost<AgentDispatch>("/api/v1/agents/dispatch", {
        request: request.trim(),
        projectId: projectId || null,
        agentIds: active ? [active.id] : undefined,
        budgetUsd,
        maxAgents: 4,
        runJudge: true,
        ...(plan?.id ? { planId: plan.id } : {}),
      }),
    onSuccess: (data) => {
      setDispatch(data);
      setPlan(data.plan);
    },
  });

  const riskColor = (risk: FabricAgent["riskLevel"]) => {
    if (risk === "LOW") return "success" as const;
    if (risk === "MEDIUM") return "info" as const;
    if (risk === "HIGH") return "warning" as const;
    return "error" as const;
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("fabricNote")}{" "}
          <Link href="/models">{t("seeModels")}</Link>
          {" · "}
          <Link href="/experts">{t("seeExperts")}</Link>
        </Alert>
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {t("verifiedKnowledgeNote")}
        </Alert>
        {verifiedSourcesQuery.data ? (
          <Box sx={{ mt: 2 }}>
            <Typography fontWeight={650}>{t("verifiedSourcesTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("verifiedSourcesHelp", {
                count: verifiedSourcesQuery.data.items.length,
              })}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => downloadVerifiedSourcesPack("json")}
              >
                {t("downloadVerifiedJson")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => downloadVerifiedSourcesPack("markdown")}
              >
                {t("downloadVerifiedMd")}
              </Button>
            </Stack>
            <Stack
              direction="row"
              flexWrap="wrap"
              useFlexGap
              spacing={1}
              sx={{ gap: 1, mt: 1.5 }}
            >
              {verifiedSourcesQuery.data.domains.map((domain) => (
                <Chip
                  key={domain}
                  size="small"
                  variant="outlined"
                  label={t(`domain.${domain}`)}
                />
              ))}
            </Stack>
            <Stack spacing={0.75} sx={{ mt: 1.5, maxHeight: 220, overflow: "auto" }}>
              {verifiedSourcesQuery.data.items.slice(0, 12).map((src) => (
                <Typography key={src.id} variant="caption" component="div">
                  <Box
                    component="a"
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: "primary.main" }}
                  >
                    {pickLocale(locale, src.titleEn, src.titleHe, src.titleEn)}
                  </Box>
                  {" · "}
                  {src.domain}
                </Typography>
              ))}
              {verifiedSourcesQuery.data.items.length > 12 ? (
                <Typography variant="caption" color="text.secondary">
                  {t("verifiedSourcesMore", {
                    n: verifiedSourcesQuery.data.items.length - 12,
                  })}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        ) : null}
      </Box>

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ gap: 1 }}>
        {CATEGORIES.map((key) => (
          <Chip
            key={key}
            clickable
            color={category === key ? "primary" : "default"}
            variant={category === key ? "filled" : "outlined"}
            label={t(`category.${key}`)}
            onClick={() => setCategory(key)}
          />
        ))}
      </Stack>

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ gap: 1 }}>
        {filtered.map((agent) => {
          const selected = agent.id === active?.id;
          return (
            <Chip
              key={agent.id}
              clickable
              color={selected ? "secondary" : "default"}
              variant={selected ? "filled" : "outlined"}
              label={titleOf(agent)}
              component={Link}
              href={`/agents?agent=${agent.id}`}
              sx={{ fontWeight: selected ? 700 : 500 }}
            />
          );
        })}
      </Stack>

      {active ? (
        <Box
          sx={{
            py: 2,
            borderTop: "1px solid rgba(20,32,34,0.12)",
            borderBottom: "1px solid rgba(20,32,34,0.12)",
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "1.2fr 1fr 1fr" },
          }}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={700} sx={{ fontSize: "1.2rem" }}>
                {titleOf(active)}
              </Typography>
              <Chip size="small" color={riskColor(active.riskLevel)} label={active.riskLevel} />
              <Chip
                size="small"
                variant="outlined"
                label={
                  active.canWriteCode ? t("writeGated") : t("readOnly")
                }
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {active.specialty}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t("costCap")}: ${active.maxCostUsd.toFixed(2)} · {costOf(active)}
            </Typography>
            <Typography variant="overline" sx={{ display: "block", mt: 1.5 }}>
              {t("tools")}
            </Typography>
            <Typography variant="body2">
              {active.allowedTools.join(" · ")}
            </Typography>
            <Typography variant="overline" sx={{ display: "block", mt: 1 }}>
              {t("forbidden")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {active.forbiddenTools.join(" · ")}
            </Typography>
            <Typography variant="overline" sx={{ display: "block", mt: 1 }}>
              {t("evidencePolicy")}
            </Typography>
            <Typography variant="body2">
              {active.evidenceRequirements.join(" · ")}
            </Typography>
          </Box>
          <Box>
            <Typography variant="overline">{t("strengths")}</Typography>
            {strengthsOf(active).map((line) => (
              <Typography key={line} variant="body2" sx={{ mt: 0.5 }}>
                + {line}
              </Typography>
            ))}
          </Box>
          <Box>
            <Typography variant="overline">{t("weaknesses")}</Typography>
            {weaknessesOf(active).map((line) => (
              <Typography key={line} variant="body2" sx={{ mt: 0.5 }}>
                − {line}
              </Typography>
            ))}
          </Box>
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
        type="number"
        label={t("budget")}
        value={budgetUsd}
        onChange={(e) => setBudgetUsd(Number(e.target.value) || 2)}
        inputProps={{ min: 0.1, max: 20, step: 0.1 }}
        sx={{ maxWidth: 200 }}
        helperText={t("budgetHelper")}
      />

      <TextField
        multiline
        minRows={3}
        fullWidth
        label={t("request")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={t("placeholder")}
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          disabled={planMutation.isPending || request.trim().length < 3 || !active}
          onClick={() => planMutation.mutate()}
        >
          {t("plan")}
        </Button>
        <Button
          variant="contained"
          disabled={
            dispatchMutation.isPending || request.trim().length < 3 || !active
          }
          onClick={() => dispatchMutation.mutate()}
        >
          {t("dispatch")}
        </Button>
      </Stack>

      {planMutation.isError ? (
        <Alert severity="error">{(planMutation.error as Error).message}</Alert>
      ) : null}
      {dispatchMutation.isError ? (
        <Alert severity="error">
          {(dispatchMutation.error as Error).message}
        </Alert>
      ) : null}

      {plan ? (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
              {t("planResult")}
            </Typography>
            <EpistemicChip
              state={
                (plan.epistemicState as "INFERRED" | "UNKNOWN") ?? "INFERRED"
              }
            />
            <Typography variant="body2" color="text.secondary">
              {t("estCost", { n: plan.estimatedTotalCostUsd.toFixed(3) })}
            </Typography>
          </Stack>
          {plan.steps.map((step) => (
            <Box
              key={`${step.agentId}-${step.rationale}`}
              sx={{ py: 1, borderBottom: "1px solid rgba(20,32,34,0.08)" }}
            >
              <Typography fontWeight={650}>{step.agentId}</Typography>
              <Typography variant="body2" color="text.secondary">
                {step.rationale}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("needs")}: {step.requiredEvidence.join(" · ")} · $
                {step.estimatedCostUsd.toFixed(3)}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : null}

      {dispatch ? (
        <Stack spacing={1.5}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
            {t("dispatchResult")} · {dispatch.traceId}
          </Typography>
          {dispatch.runs.map((run) => (
            <Box
              key={`${run.agentId}-${run.summary}`}
              sx={{ py: 1.25, borderBottom: "1px solid rgba(20,32,34,0.1)" }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={run.status} />
                <Typography fontWeight={650}>{run.agentId}</Typography>
                <EpistemicChip
                  state={
                    (run.epistemicState as
                      | "INFERRED"
                      | "UNVERIFIED"
                      | "UNKNOWN") ?? "INFERRED"
                  }
                />
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {run.summary}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {run.evidenceRefs.join(" · ")} · ${run.costUsd.toFixed(3)}
              </Typography>
            </Box>
          ))}
          {dispatch.judge ? (
            <Alert
              severity={
                dispatch.judge.decision === "APPROVE"
                  ? "success"
                  : dispatch.judge.decision === "REJECT"
                    ? "error"
                    : "warning"
              }
            >
              <Typography fontWeight={700}>
                {t("judge")}: {dispatch.judge.decision} (
                {Math.round(dispatch.judge.confidence * 100)}%)
              </Typography>
              <Typography variant="body2">{dispatch.judge.rationale}</Typography>
              {dispatch.judge.missingEvidence.length > 0 ? (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {t("missingEvidence")}:{" "}
                  {dispatch.judge.missingEvidence.join(" · ")}
                </Typography>
              ) : null}
            </Alert>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
