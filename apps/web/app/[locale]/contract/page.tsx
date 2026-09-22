"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
}

interface ArchitectureContract {
  id: string;
  projectId: string | null;
  name: string;
  allowedEdges: Array<{ from: string; to: string }>;
  forbiddenEdges: Array<{ from: string; to: string }>;
  createdAt: string;
}

export default function ArchitectureContractPage() {
  const t = useTranslations();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [forbiddenText, setForbiddenText] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const projectId = selectedId;

  const contract = useQuery({
    queryKey: ["arch-contract", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<ArchitectureContract>(
        `/api/v1/audit-engine/contract?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  useEffect(() => {
    if (!contract.data) return;
    setName(contract.data.name);
    setForbiddenText(
      contract.data.forbiddenEdges.map((e) => `${e.from} -> ${e.to}`).join("\n"),
    );
  }, [contract.data]);

  const save = useMutation({
    mutationFn: async () => {
      const base =
        contract.data ??
        (await apiGet<ArchitectureContract>(
          "/api/v1/audit-engine/contract/default",
        ));
      const forbiddenEdges = forbiddenText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("->").map((s) => s.trim());
          const from = parts[0];
          const to = parts[1];
          if (!from || !to || parts.length !== 2) {
            throw new Error(t("contract.invalidEdge"));
          }
          return { from, to };
        });
      return apiPut<ArchitectureContract>("/api/v1/audit-engine/contract", {
        ...base,
        id: base.id || crypto.randomUUID(),
        projectId: projectId || null,
        name: name || base.name,
        forbiddenEdges:
          forbiddenEdges.length > 0 ? forbiddenEdges : base.forbiddenEdges,
        createdAt: base.createdAt || new Date().toISOString(),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["arch-contract", projectId] });
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Box>
        <Typography variant="h4" sx={{ fontFamily: '"Fraunces", serif', mb: 1 }}>
          {t("contract.title")}
        </Typography>
        <Typography color="text.secondary">{t("contract.subtitle")}</Typography>
      </Box>

      <TextField
        select
        size="small"
        label={t("dashboard.projectSelect")}
        value={projectId}
        onChange={(e) => setSelectedId(e.target.value)}
        sx={{ maxWidth: 420 }}
      >
        <MenuItem value="">{t("dashboard.projectSelect")}</MenuItem>
        {(projects.data?.items ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label={t("contract.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
      />
      <TextField
        label={t("contract.forbidden")}
        helperText={t("contract.forbiddenHelp")}
        value={forbiddenText}
        onChange={(e) => setForbiddenText(e.target.value)}
        multiline
        minRows={4}
        fullWidth
      />

      <Button
        variant="contained"
        disabled={!projectId || save.isPending}
        onClick={() => save.mutate()}
      >
        {t("contract.save")}
      </Button>

      {save.isSuccess ? (
        <Alert severity="success">{t("contract.saved")}</Alert>
      ) : null}
      {projects.isError ? (
        <Alert severity="error">{(projects.error as Error).message}</Alert>
      ) : null}
      {contract.isError ? (
        <Alert severity="error">{(contract.error as Error).message}</Alert>
      ) : null}
      {save.isError ? (
        <Alert severity="error">
          {(save.error as Error).message || t("contract.saveFailed")}
        </Alert>
      ) : null}
    </Stack>
  );
}
