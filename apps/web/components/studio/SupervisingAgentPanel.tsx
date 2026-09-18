"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";

interface PsaRecord {
  agentClass: string;
  agentId: string;
  status: string;
  recommendations: Array<{ id: string; reason: string; severity: string }>;
  escalations: Array<{ id: string; reason: string; severity: string }>;
}

interface PsaObservation {
  agentId?: string;
  status?: string;
  attention?: Array<{ id: string; reason: string; severity: string }>;
}

interface PsaMemoryItem {
  id: string;
  statement: string;
  epistemicState: string;
  category: string;
  projectId: string | null;
}

interface PsaMemorySlice {
  items: PsaMemoryItem[];
  truncated: boolean;
}

interface CoordinationPlan {
  id?: string;
  steps?: Array<{ agentId: string; rationale?: string }>;
}

/**
 * Studio accompaniment for the owner's Personal Supervising Agent.
 * PSA does not propose, approve, or apply patches — Studio governance stays on Patch/Apply.
 * This panel is not the CODE_ENGINEER ask-agent path.
 */
export function SupervisingAgentPanel({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations("studio.psa");
  const queryClient = useQueryClient();
  const autoLinked = useRef(false);
  const [coordinateRequest, setCoordinateRequest] = useState("");

  const psa = useQuery({
    queryKey: ["supervising-agent"],
    queryFn: async () => {
      try {
        return await apiGet<PsaRecord>("/api/v1/supervising-agent");
      } catch (error) {
        if (error instanceof Error && /not initialized|404/i.test(error.message)) {
          return null;
        }
        throw error;
      }
    },
  });

  const observation = useQuery({
    queryKey: ["supervising-agent-observation"],
    enabled: Boolean(psa.data?.agentId),
    queryFn: () => apiGet<PsaObservation>("/api/v1/supervising-agent/observation"),
  });

  const memory = useQuery({
    queryKey: ["supervising-agent-memory", projectId],
    enabled: Boolean(psa.data?.agentId) && Boolean(projectId),
    queryFn: () =>
      apiGet<PsaMemorySlice>(
        `/api/v1/supervising-agent/memory?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const ensure = useMutation({
    mutationFn: () =>
      apiPost<PsaRecord>("/api/v1/supervising-agent", {
        tenantId: "user-plane",
        projectIds: projectId ? [projectId] : [],
        applicationIds: ["def-000"],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["supervising-agent"] });
      void queryClient.invalidateQueries({ queryKey: ["supervising-agent-observation"] });
      void queryClient.invalidateQueries({ queryKey: ["supervising-agent-memory"] });
    },
  });

  const coordinate = useMutation({
    mutationFn: () =>
      apiPost<CoordinationPlan>("/api/v1/supervising-agent/coordinate", {
        request: coordinateRequest.trim(),
        projectId,
      }),
  });

  useEffect(() => {
    if (autoLinked.current) return;
    if (!projectId || psa.isLoading || psa.isError) return;
    if (psa.data?.agentId) return;
    if (ensure.isPending || ensure.isError) return;
    autoLinked.current = true;
    ensure.mutate();
  }, [
    projectId,
    psa.isLoading,
    psa.isError,
    psa.data?.agentId,
    ensure.isPending,
    ensure.isError,
    ensure.mutate,
  ]);

  const record = psa.data;
  const items = [
    ...(record?.recommendations ?? []),
    ...(record?.escalations ?? []),
    ...(observation.data?.attention ?? []),
  ];
  const memories = memory.data?.items ?? [];

  return (
    <Box
      sx={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 3,
        p: 2.25,
        bgcolor: "rgba(12,14,18,0.65)",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
        <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>
          {t("title")}
        </Typography>
        {record?.status ? (
          <Chip size="small" label={record.status} />
        ) : (
          <Chip size="small" label={t("notLinked")} variant="outlined" />
        )}
      </Stack>
      <Typography variant="body2" sx={{ color: "rgba(220,221,225,0.72)", mb: 1.5 }}>
        {t("help")}
      </Typography>
      {record?.agentId ? (
        <Typography variant="caption" sx={{ color: "rgba(220,221,225,0.55)", display: "block" }}>
          {record.agentId}
        </Typography>
      ) : (
        <Button
          size="small"
          variant="outlined"
          onClick={() => ensure.mutate()}
          disabled={ensure.isPending || !projectId}
        >
          {t("link")}
        </Button>
      )}
      {psa.isError || ensure.isError ? (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {t("unavailable")}
        </Alert>
      ) : null}

      {record?.agentId ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
            {t("memoryTitle")}
          </Typography>
          {memory.isError ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              {t("unavailable")}
            </Alert>
          ) : memories.length === 0 ? (
            <Typography variant="body2" sx={{ color: "rgba(220,221,225,0.55)", mt: 0.75 }}>
              {memory.isLoading ? "…" : t("memoryEmpty")}
            </Typography>
          ) : (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {memories.slice(0, 8).map((item) => (
                <Typography key={item.id} variant="body2" sx={{ color: "#DCDDE1" }}>
                  {item.epistemicState}: {item.statement}
                </Typography>
              ))}
              {memory.data?.truncated ? (
                <Typography variant="caption" sx={{ color: "rgba(220,221,225,0.55)" }}>
                  {t("memoryTruncated")}
                </Typography>
              ) : null}
            </Stack>
          )}
          <Button
            component={Link}
            href="/memory"
            size="small"
            variant="text"
            sx={{ mt: 0.75, px: 0 }}
          >
            {t("openMemory")}
          </Button>
        </Box>
      ) : null}

      {items.length > 0 ? (
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {items.slice(0, 5).map((item) => (
            <Typography key={item.id} variant="body2" sx={{ color: "#DCDDE1" }}>
              {item.severity}: {item.reason}
            </Typography>
          ))}
        </Stack>
      ) : record?.agentId ? (
        <Typography variant="body2" sx={{ color: "rgba(220,221,225,0.55)", mt: 1 }}>
          {t("noAttention")}
        </Typography>
      ) : null}

      {record?.agentId ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
            {t("coordinateLabel")}
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(220,221,225,0.55)", display: "block", mb: 1 }}>
            {t("coordinateHelp")}
          </Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={coordinateRequest}
            onChange={(event) => setCoordinateRequest(event.target.value)}
            placeholder={t("coordinatePlaceholder")}
          />
          <Button
            size="small"
            variant="outlined"
            sx={{ mt: 1 }}
            disabled={coordinate.isPending || coordinateRequest.trim().length === 0}
            onClick={() => coordinate.mutate()}
          >
            {t("coordinate")}
          </Button>
          {coordinate.isError ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {(coordinate.error as Error).message}
            </Alert>
          ) : null}
          {coordinate.data?.steps && coordinate.data.steps.length > 0 ? (
            <Stack spacing={0.5} sx={{ mt: 1.25 }}>
              <Typography variant="caption" sx={{ color: "rgba(220,221,225,0.55)" }}>
                {t("coordinateResult")}
                {coordinate.data.id ? ` · ${coordinate.data.id}` : ""}
              </Typography>
              {coordinate.data.steps.map((step, index) => (
                <Typography
                  key={`${step.agentId}-${index}`}
                  variant="body2"
                  sx={{ color: "#DCDDE1" }}
                >
                  {step.agentId}
                  {step.rationale ? ` — ${step.rationale}` : ""}
                </Typography>
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
