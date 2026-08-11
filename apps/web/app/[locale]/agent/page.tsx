"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  MenuItem,
  Alert,
  Tooltip,
  ListItemText,
} from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface Project {
  id: string;
  slug: string;
  name: string;
}

interface ProviderItem {
  id: string;
  vendor?: string;
  titleEn: string;
  titleHe: string;
  titleAr: string;
  billing: "included" | "credits";
  priceTier?: "free" | "low" | "mid" | "high";
  creditCost: number;
  kind: string;
  skills?: string[];
  strengthsHe?: string[];
  strengthsEn?: string[];
  weaknessesHe?: string[];
  weaknessesEn?: string[];
  bestForHe: string;
  bestForEn: string;
  available: boolean;
}

interface AgentRunResponse {
  run: {
    id: string;
    answer: string | null;
    mode: string;
    status: string;
    epistemicState:
      | "FACT"
      | "CONFIRMED"
      | "VERIFIED"
      | "OBSERVED"
      | "INFERRED"
      | "ASSUMED"
      | "PROPOSED"
      | "UNVERIFIED"
      | "CONTRADICTED"
      | "STALE"
      | "UNKNOWN"
      | "CONFLICTED"
      | null;
  };
  intent: { kind: string; requiresApproval: boolean };
  learnedMemoryId?: string | null;
  patchId?: string | null;
  engineeringMode?: string;
}

const PORTFOLIO = "__portfolio__";
const ENG_MODES = [
  "analyze",
  "plan",
  "generate",
  "fix",
  "refactor",
  "test",
  "secure",
  "optimize",
  "implement",
] as const;
const AGENT_IDS = [
  "arletos-included",
  "claude-haiku",
  "deepseek-chat",
  "gpt-4o-mini",
  "gemini-flash",
  "llama-groq",
  "llama-local",
  "claude-sonnet",
  "gpt-4o",
  "gemini-pro",
  "claude-opus",
  "o3-mini",
] as const;

export default function AgentPage() {
  const t = useTranslations("agent");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState(PORTFOLIO);
  const [request, setRequest] = useState("");
  const [aiProviderId, setAiProviderId] =
    useState<(typeof AGENT_IDS)[number]>("arletos-included");
  const [engineeringMode, setEngineeringMode] =
    useState<(typeof ENG_MODES)[number]>("analyze");
  const [workspaceRoot, setWorkspaceRoot] = useState(
    "C:\\Users\\User\\Desktop\\game\\taqono",
  );
  const [result, setResult] = useState<AgentRunResponse | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const providersQuery = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => apiGet<{ items: ProviderItem[] }>("/api/v1/ai/providers"),
  });

  useEffect(() => {
    const fromUrl = searchParams.get("provider");
    if (fromUrl && (AGENT_IDS as readonly string[]).includes(fromUrl)) {
      setAiProviderId(fromUrl as (typeof AGENT_IDS)[number]);
    }
  }, [searchParams]);

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const agentProviders = useMemo((): ProviderItem[] => {
    const fromApi = (providersQuery.data?.items ?? []).filter(
      (p) =>
        (AGENT_IDS as readonly string[]).includes(p.id) &&
        (p.kind === "agent" || p.kind === "both"),
    );
    if (fromApi.length > 0) return fromApi;
    return AGENT_IDS.map((id) => ({
      id,
      vendor: "",
      titleEn: id,
      titleHe: id,
      titleAr: id,
      billing: id === "arletos-included" ? "included" : "credits",
      priceTier: id === "arletos-included" ? "free" : "low",
      creditCost: id === "arletos-included" ? 0 : 1,
      kind: "agent",
      bestForHe: "",
      bestForEn: "",
      available: true,
    }));
  }, [providersQuery.data]);

  const selected = agentProviders.find((p) => p.id === aiProviderId);

  const mutation = useMutation({
    mutationFn: async () =>
      apiPost<AgentRunResponse>("/api/v1/agent/runs", {
        mode: "READ",
        projectId: projectId === PORTFOLIO ? null : projectId,
        userRequest: request || t("defaultContinue"),
        aiProviderId,
        engineeringMode,
        proposePatch: [
          "generate",
          "fix",
          "refactor",
          "test",
          "secure",
          "optimize",
          "implement",
        ].includes(engineeringMode),
        workspaceRoot,
      }),
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({ queryKey: ["credits"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      await queryClient.invalidateQueries({ queryKey: ["patches"] });
    },
  });

  const providerTitle = (p: ProviderItem) =>
    locale === "he" ? p.titleHe : locale === "ar" ? p.titleAr : p.titleEn;

  const hoverFor = (p: ProviderItem) => {
    const best = locale === "en" ? p.bestForEn : p.bestForHe;
    const strengths = (locale === "en" ? p.strengthsEn : p.strengthsHe)?.slice(0, 2) ?? [];
    const price =
      p.billing === "included"
        ? t("included")
        : `${t("creditsCost", { n: p.creditCost })} · ${p.priceTier ?? ""}`;
    return (
      <Box sx={{ maxWidth: 300, p: 0.5 }}>
        <Typography variant="subtitle2" sx={{ color: "#fff" }}>
          {providerTitle(p)}
          {p.vendor ? ` · ${p.vendor}` : ""}
        </Typography>
        <Typography variant="body2" sx={{ color: "#fff", mt: 0.5 }}>
          {price}
        </Typography>
        {best ? (
          <Typography variant="body2" sx={{ color: "#fff", mt: 0.5 }}>
            {best}
          </Typography>
        ) : null}
        {strengths.map((s) => (
          <Typography key={s} variant="caption" sx={{ color: "#ddd", display: "block" }}>
            + {s}
          </Typography>
        ))}
      </Box>
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 860 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("providerPickerHint")}{" "}
          <Link href="/models">{t("seeAllModels")}</Link>
        </Typography>
      </Box>

      <TextField
        select
        label={t("aiProvider")}
        value={aiProviderId}
        onChange={(e) =>
          setAiProviderId(e.target.value as (typeof AGENT_IDS)[number])
        }
        helperText={
          selected
            ? `${locale === "en" ? selected.bestForEn : selected.bestForHe} · ${
                selected.billing === "included"
                  ? t("included")
                  : t("creditsCost", { n: selected.creditCost })
              }${selected.priceTier ? ` · ${selected.priceTier}` : ""}`
            : undefined
        }
      >
        {agentProviders.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            <Tooltip title={hoverFor(p)} placement="left" enterDelay={250}>
              <ListItemText
                primary={`${providerTitle(p)}${
                  p.billing === "credits"
                    ? ` · ${p.creditCost} cr`
                    : ` · ${t("included")}`
                }`}
                secondary={
                  p.priceTier
                    ? `${p.vendor ?? ""} · ${p.priceTier}`
                    : p.vendor
                }
              />
            </Tooltip>
          </MenuItem>
        ))}
      </TextField>

      {selected?.billing === "credits" ? (
        <Alert severity="warning">{t("paidWarning")}</Alert>
      ) : (
        <Alert severity="success">{t("freeProviderHint")}</Alert>
      )}

      <TextField
        select
        label={t("engineeringMode")}
        value={engineeringMode}
        onChange={(e) =>
          setEngineeringMode(e.target.value as (typeof ENG_MODES)[number])
        }
        helperText={t("engineeringModeHelp")}
      >
        {ENG_MODES.map((m) => (
          <MenuItem key={m} value={m}>
            {t(`modes.${m}`)}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label={t("workspaceRoot")}
        value={workspaceRoot}
        onChange={(e) => setWorkspaceRoot(e.target.value)}
        helperText={t("workspaceHelp")}
        fullWidth
      />

      <TextField
        select
        label={t("projectLabel")}
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
        sx={{ maxWidth: 360 }}
        helperText={projects.length === 0 ? t("noProjects") : undefined}
      >
        <MenuItem value={PORTFOLIO}>{t("portfolio")}</MenuItem>
        {projects.map((project) => (
          <MenuItem key={project.id} value={project.id}>
            {project.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        multiline
        minRows={3}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        placeholder={t("placeholder")}
        fullWidth
      />

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="outlined"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {t("plan")}
        </Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {t("execute")}
        </Button>
      </Stack>

      {mutation.isError ? (
        <Alert severity="error">{(mutation.error as Error).message}</Alert>
      ) : null}

      {result ? (
        <Box
          sx={{
            borderTop: "1px solid rgba(20,32,34,0.14)",
            pt: 2.5,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <EpistemicChip state={result.run.epistemicState ?? "PROPOSED"} />
            <Typography variant="body2" color="text.secondary">
              {result.run.mode} · {result.run.status} · {result.intent.kind}
            </Typography>
          </Stack>
          <Typography sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
            {result.run.answer}
          </Typography>
          <Typography variant="overline">{t("evidence")}</Typography>
          <Typography variant="body2">{t("contextUsed")}</Typography>
          {result.learnedMemoryId ? (
            <Alert severity="success" sx={{ mt: 1.5 }}>
              {t("learnedMemory")}
            </Alert>
          ) : null}
          {result.patchId ? (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              {t("patchReady")}{" "}
              <Link href="/patches">{t("openPatches")}</Link>
            </Alert>
          ) : null}
          {result.intent.requiresApproval ? (
            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
              {t("approvalRequired")}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
