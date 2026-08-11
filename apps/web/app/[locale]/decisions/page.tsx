"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";

interface Decision {
  id: string;
  projectId: string | null;
  decision: string;
  reason: string[];
  status: string;
  epistemicState:
    | "FACT"
    | "CONFIRMED"
    | "INFERRED"
    | "PROPOSED"
    | "UNKNOWN"
    | "CONFLICTED";
  decidedAt: string;
  adrPath: string | null;
}

interface Project {
  id: string;
  name: string;
}

export default function DecisionsPage() {
  const t = useTranslations("decisions");
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const decisionsQuery = useQuery({
    queryKey: ["decisions"],
    queryFn: () => apiGet<{ items: Decision[] }>("/api/v1/decisions"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<Decision>("/api/v1/decisions", {
        projectId: projectId || null,
        decision: decision.trim(),
        reason: reason.trim() ? [reason.trim()] : [],
        status: "ACTIVE",
        epistemicState: "CONFIRMED",
      }),
    onSuccess: async () => {
      setDecision("");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
    },
  });

  const items = decisionsQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];

  return (
    <Stack spacing={3} sx={{ maxWidth: 820 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Stack spacing={1.5}>
        <TextField
          select
          label={t("project")}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          helperText={t("projectHelper")}
        >
          <MenuItem value="">{t("global")}</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t("decision")}
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
        <TextField
          label={t("reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
        />
        <Button
          variant="contained"
          disabled={create.isPending || decision.trim().length < 3}
          onClick={() => create.mutate()}
          sx={{ alignSelf: "flex-start" }}
        >
          {t("save")}
        </Button>
        {create.isError ? (
          <Alert severity="error">{(create.error as Error).message}</Alert>
        ) : null}
      </Stack>

      <Stack spacing={0}>
        {items.length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          items.map((item) => (
            <Box
              key={item.id}
              sx={{
                py: 2,
                borderBottom: "1px solid rgba(20,32,34,0.12)",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <EpistemicChip state={item.epistemicState} />
                <Typography variant="body2" color="text.secondary">
                  {item.status} · {new Date(item.decidedAt).toLocaleString()}
                </Typography>
              </Stack>
              <Typography fontWeight={650}>{item.decision}</Typography>
              {item.reason[0] ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {item.reason[0]}
                </Typography>
              ) : null}
            </Box>
          ))
        )}
      </Stack>
    </Stack>
  );
}
