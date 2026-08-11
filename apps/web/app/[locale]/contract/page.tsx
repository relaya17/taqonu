"use client";

import { useEffect, useMemo, useState } from "react";
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

  const projectId = useMemo(() => {
    if (selectedId) return selectedId;
    return projects.data?.items[0]?.id ?? "";
  }, [selectedId, projects.data]);

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
          const [from, to] = line.split("->").map((s) => s.trim());
          return { from: from || "FRONTEND", to: to || "DATABASE" };
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
      {save.isError ? (
        <Alert severity="error">{t("contract.saveFailed")}</Alert>
      ) : null}
    </Stack>
  );
}
