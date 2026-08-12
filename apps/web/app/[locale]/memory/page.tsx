"use client";

import { useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";

type EpistemicState =
  | "FACT"
  | "CONFIRMED"
  | "OBSERVED"
  | "INFERRED"
  | "PROPOSED"
  | "ASSUMED"
  | "UNVERIFIED"
  | "UNKNOWN"
  | "CONFLICTED";

interface Memory {
  id: string;
  type: string;
  statement: string;
  status: string;
  epistemicState: EpistemicState;
  createdAt: string;
  priority: string;
  projectId: string | null;
  cloudSynced?: boolean;
}

interface Project {
  id: string;
  name: string;
}

const PENDING_STATES = new Set<EpistemicState>([
  "PROPOSED",
  "INFERRED",
  "UNVERIFIED",
  "ASSUMED",
]);

function MemoryRow({
  item,
  onApprove,
  approving,
}: {
  item: Memory;
  onApprove?: (item: Memory) => void;
  approving: boolean;
}) {
  const t = useTranslations("memory");
  return (
    <Box
      sx={{
        py: 2,
        borderBottom: "1px solid rgba(20,32,34,0.12)",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 0.5 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <EpistemicChip state={item.epistemicState} />
          <Typography variant="body2" color="text.secondary">
            {item.type} · {item.priority}
          </Typography>
          {item.cloudSynced ? (
            <Chip size="small" variant="outlined" label={t("cloudSynced")} />
          ) : null}
        </Stack>
        {onApprove ? (
          <Button
            size="small"
            variant="contained"
            disabled={approving}
            onClick={() => onApprove(item)}
          >
            {t("approve")}
          </Button>
        ) : null}
      </Stack>
      <Typography fontWeight={650}>{item.statement}</Typography>
    </Box>
  );
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

  const pendingQuery = useQuery({
    queryKey: ["memory-pending"],
    queryFn: () => apiGet<{ items: Memory[] }>("/api/v1/memory/pending"),
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
      await queryClient.invalidateQueries({ queryKey: ["memory-pending"] });
    },
  });

  const approve = useMutation({
    mutationFn: (item: Memory) =>
      apiPost<Memory>(`/api/v1/memory/${item.id}/approve`, {
        projectId: item.projectId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      await queryClient.invalidateQueries({ queryKey: ["memory-pending"] });
    },
  });

  const items = memoryQuery.data?.items ?? [];
  const pendingItems = pendingQuery.data?.items ?? [];
  const pendingIds = new Set(pendingItems.map((p) => p.id));
  const confirmedItems = items.filter(
    (item) => !pendingIds.has(item.id) && !PENDING_STATES.has(item.epistemicState),
  );
  const projects = projectsQuery.data?.items ?? [];

  return (
    <Stack spacing={4} sx={{ maxWidth: 820 }}>
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

      <Box>
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("pendingTitle")} {pendingItems.length > 0 ? `(${pendingItems.length})` : ""}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("pendingHelp")}
        </Typography>
        {approve.isError ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {(approve.error as Error).message}
          </Alert>
        ) : null}
        <Stack spacing={0}>
          {pendingItems.length === 0 ? (
            <Typography color="text.secondary">{t("pendingEmpty")}</Typography>
          ) : (
            pendingItems.map((item) => (
              <MemoryRow
                key={item.id}
                item={item}
                approving={approve.isPending}
                onApprove={(m) => approve.mutate(m)}
              />
            ))
          )}
        </Stack>
      </Box>

      <Box>
        <Typography fontWeight={650} sx={{ mb: 0.5 }}>
          {t("confirmedTitle")}
        </Typography>
        <Stack spacing={0}>
          {confirmedItems.length === 0 ? (
            <Typography color="text.secondary">{t("empty")}</Typography>
          ) : (
            confirmedItems.map((item) => (
              <MemoryRow key={item.id} item={item} approving={false} />
            ))
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
