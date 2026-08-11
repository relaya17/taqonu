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

interface Memory {
  id: string;
  type: string;
  statement: string;
  status: string;
  epistemicState:
    | "FACT"
    | "CONFIRMED"
    | "INFERRED"
    | "PROPOSED"
    | "UNKNOWN"
    | "CONFLICTED";
  createdAt: string;
  priority: string;
}

interface Project {
  id: string;
  name: string;
}

export default function MemoryPage() {
  const t = useTranslations("memory");
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState("");
  const [type, setType] = useState("PREFERENCE");
  const [projectId, setProjectId] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const memoryQuery = useQuery({
    queryKey: ["memory"],
    queryFn: () => apiGet<{ items: Memory[] }>("/api/v1/memory"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<Memory>("/api/v1/memory", {
        type,
        projectId: projectId || null,
        statement: statement.trim(),
        category: "DECISION_MEMORY",
        epistemicState: "CONFIRMED",
        observationMode: "CONFIRMED",
        source: "ui",
        sourceType: "USER",
        scope: projectId ? "PROJECT" : "GLOBAL",
        priority: "MEDIUM",
      }),
    onSuccess: async () => {
      setStatement("");
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });

  const items = memoryQuery.data?.items ?? [];
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
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            select
            label={t("type")}
            value={type}
            onChange={(e) => setType(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {["PREFERENCE", "DECISION", "LESSON", "FACT", "GOAL"].map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t("project")}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{t("global")}</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <TextField
          label={t("statement")}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
        <Button
          variant="contained"
          disabled={create.isPending || statement.trim().length < 3}
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
                  {item.type} · {item.priority}
                </Typography>
              </Stack>
              <Typography fontWeight={650}>{item.statement}</Typography>
            </Box>
          ))
        )}
      </Stack>
    </Stack>
  );
}
