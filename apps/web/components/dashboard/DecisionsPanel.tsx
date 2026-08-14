"use client";

import { useMemo, useState } from "react";
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

type DecisionStatus = "PROPOSED" | "ACTIVE" | "REJECTED" | "SUPERSEDED";

type EpistemicState =
  | "FACT"
  | "CONFIRMED"
  | "INFERRED"
  | "PROPOSED"
  | "UNKNOWN"
  | "CONFLICTED";

interface Decision {
  id: string;
  projectId: string | null;
  decision: string;
  reason: string[];
  alternatives: string[];
  tradeOffs: string[];
  evidence: string[];
  status: DecisionStatus;
  epistemicState: EpistemicState;
  supersededBy: string | null;
  adrPath: string | null;
  decidedAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
}

interface EvidenceRecord {
  id: string;
  projectId: string | null;
  source: string;
  excerpt: string | null;
}

const STATUS_FILTERS: Array<DecisionStatus | "ALL"> = [
  "ALL",
  "PROPOSED",
  "ACTIVE",
  "REJECTED",
  "SUPERSEDED",
];

function statusColor(
  status: DecisionStatus,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PROPOSED":
      return "warning";
    case "REJECTED":
      return "error";
    case "SUPERSEDED":
      return "info";
    default:
      return "default";
  }
}

function nextActions(status: DecisionStatus): Array<"ACTIVE" | "REJECTED" | "SUPERSEDED"> {
  if (status === "PROPOSED") return ["ACTIVE", "REJECTED", "SUPERSEDED"];
  if (status === "ACTIVE") return ["SUPERSEDED", "REJECTED"];
  return [];
}

export function DecisionsPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("decisions");
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [adrPath, setAdrPath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [supersedeWith, setSupersedeWith] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const decisionsQuery = useQuery({
    queryKey: ["decisions"],
    queryFn: () => apiGet<{ items: Decision[] }>("/api/v1/decisions"),
  });

  const evidenceQuery = useQuery({
    queryKey: ["evidence"],
    queryFn: () => apiGet<{ items: EvidenceRecord[] }>("/api/v1/evidence"),
  });

  const create = useMutation({
    mutationFn: () => {
      const evidence = evidenceText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const alts = alternatives
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return apiPost<Decision>("/api/v1/decisions", {
        projectId: projectId || null,
        decision: decision.trim(),
        reason: reason.trim() ? [reason.trim()] : [],
        alternatives: alts,
        evidence,
        adrPath: adrPath.trim() || null,
        status: "PROPOSED",
        epistemicState: "PROPOSED",
      });
    },
    onSuccess: async (created) => {
      setDecision("");
      setReason("");
      setAlternatives("");
      setEvidenceText("");
      setAdrPath("");
      setSelectedId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
    },
  });

  const transition = useMutation({
    mutationFn: ({
      id,
      status,
      supersededBy,
    }: {
      id: string;
      status: "ACTIVE" | "REJECTED" | "SUPERSEDED";
      supersededBy?: string;
    }) =>
      apiPost<Decision>(`/api/v1/decisions/${id}/transition`, {
        status,
        ...(status === "SUPERSEDED" ? { supersededBy } : {}),
      }),
    onSuccess: async (updated) => {
      setSelectedId(updated.id);
      setSupersedeWith("");
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
    },
  });

  const projects = projectsQuery.data?.items ?? [];
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string | null) =>
      id ? (map.get(id) ?? id.slice(0, 8)) : t("global");
  }, [projects, t]);

  const items = useMemo(() => {
    const all = decisionsQuery.data?.items ?? [];
    if (statusFilter === "ALL") return all;
    return all.filter((d) => d.status === statusFilter);
  }, [decisionsQuery.data?.items, statusFilter]);

  const selected = items.find((d) => d.id === selectedId) ??
    decisionsQuery.data?.items.find((d) => d.id === selectedId) ??
    null;

  const successorOptions = useMemo(() => {
    const all = decisionsQuery.data?.items ?? [];
    return all.filter(
      (d) =>
        d.id !== selected?.id &&
        (d.status === "ACTIVE" || d.status === "PROPOSED"),
    );
  }, [decisionsQuery.data?.items, selected?.id]);

  const evidenceItems = useMemo(() => {
    const all = evidenceQuery.data?.items ?? [];
    if (!projectId) return all.slice(0, 12);
    return all.filter((ev) => ev.projectId === projectId || ev.projectId === null);
  }, [evidenceQuery.data?.items, projectId]);

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920, width: "100%", minWidth: 0 }}>
      {!embedded ? (
        <Box>
          <Typography variant="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.4rem" }, wordBreak: "break-word" }}>
            {t("title")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("subtitle")}
          </Typography>
        </Box>
      ) : null}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending && decision.trim().length >= 3) {
            create.mutate();
          }
        }}
      >
      <Stack spacing={1.5}>
        <Typography variant="h2" sx={{ fontSize: "1.15rem", fontWeight: 650 }}>
          {t("createTitle")}
        </Typography>
        <TextField
          select
          label={t("project")}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          helperText={t("projectHelper")}
          fullWidth
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
        <TextField
          label={t("alternatives")}
          value={alternatives}
          onChange={(e) => setAlternatives(e.target.value)}
          helperText={t("alternativesHelper")}
          multiline
          minRows={2}
          fullWidth
        />
        <TextField
          label={t("evidence")}
          value={evidenceText}
          onChange={(e) => setEvidenceText(e.target.value)}
          helperText={t("evidenceHelper")}
          multiline
          minRows={2}
          fullWidth
        />
        {evidenceItems.length > 0 ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="group" aria-label={t("evidence")}>
            {evidenceItems.slice(0, 8).map((ev) => (
              <Chip
                key={ev.id}
                size="small"
                variant="outlined"
                clickable
                label={ev.source}
                onClick={() =>
                  setEvidenceText((prev) =>
                    prev.includes(ev.id)
                      ? prev
                      : prev.trim().length > 0
                        ? `${prev.trim()}\n${ev.id}`
                        : ev.id,
                  )
                }
              />
            ))}
          </Stack>
        ) : null}
        <TextField
          label={t("adrPath")}
          value={adrPath}
          onChange={(e) => setAdrPath(e.target.value)}
          helperText={t("adrPathHelper")}
          fullWidth
        />
        <Button
          type="submit"
          variant="contained"
          disabled={create.isPending || decision.trim().length < 3}
          sx={{ alignSelf: "flex-start" }}
        >
          {t("save")}
        </Button>
        {create.isError ? (
          <Alert severity="error">{(create.error as Error).message}</Alert>
        ) : null}
      </Stack>
      </Box>

      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="h2" sx={{ fontSize: "1.15rem", fontWeight: 650 }}>
            {t("listTitle")}
          </Typography>
          <TextField
            select
            size="small"
            label={t("filterStatus")}
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as DecisionStatus | "ALL")
            }
            sx={{ minWidth: { xs: "100%", sm: 160 }, maxWidth: "100%" }}
          >
            {STATUS_FILTERS.map((s) => (
              <MenuItem key={s} value={s}>
                {s === "ALL" ? t("filterAll") : t(`status.${s}`)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {decisionsQuery.isError ? (
          <Alert severity="error">
            {(decisionsQuery.error as Error).message}
          </Alert>
        ) : null}

        {items.length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          items.map((item) => {
            const open = selectedId === item.id;
            return (
              <Box
                key={item.id}
                sx={{
                  py: 2,
                  borderBottom: "1px solid rgba(26,31,42,0.12)",
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <EpistemicChip state={item.epistemicState} />
                    <Chip
                      size="small"
                      color={statusColor(item.status)}
                      label={t(`status.${item.status}`)}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {projectName(item.projectId)} ·{" "}
                      {new Date(item.updatedAt).toLocaleString()}
                    </Typography>
                  </Stack>
                  <Button
                    size="small"
                    variant={open ? "contained" : "outlined"}
                    onClick={() =>
                      setSelectedId((prev) => (prev === item.id ? null : item.id))
                    }
                  >
                    {open ? t("hideDetail") : t("showDetail")}
                  </Button>
                </Stack>
                <Typography fontWeight={650} sx={{ mt: 0.75 }}>
                  {item.decision}
                </Typography>
                {item.reason[0] ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {item.reason[0]}
                  </Typography>
                ) : null}

                {open && selected ? (
                  <Stack spacing={1.5} sx={{ mt: 2 }}>
                    {selected.alternatives.length > 0 ? (
                      <Box>
                        <Typography variant="body2" fontWeight={650}>
                          {t("alternatives")}
                        </Typography>
                        {selected.alternatives.map((alt) => (
                          <Typography key={alt} variant="body2" color="text.secondary">
                            · {alt}
                          </Typography>
                        ))}
                      </Box>
                    ) : null}
                    {selected.evidence.length > 0 ? (
                      <Box>
                        <Typography variant="body2" fontWeight={650}>
                          {t("evidence")}
                        </Typography>
                        {selected.evidence.map((ev) => (
                          <Typography key={ev} variant="body2" color="text.secondary">
                            · {ev}
                          </Typography>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {t("noEvidence")}
                      </Typography>
                    )}
                    {selected.adrPath ? (
                      <Typography variant="body2">
                        {t("adrPath")}: {selected.adrPath}
                      </Typography>
                    ) : null}
                    {selected.supersededBy ? (
                      <Typography variant="body2" color="text.secondary">
                        {t("supersededBy")}: {selected.supersededBy}
                      </Typography>
                    ) : null}

                    {nextActions(selected.status).length > 0 ? (
                      <Stack spacing={1}>
                        <Typography variant="body2" fontWeight={650}>
                          {t("lifecycle")}
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {nextActions(selected.status).includes("ACTIVE") ? (
                            <Button
                              size="small"
                              variant="contained"
                              disabled={transition.isPending}
                              onClick={() =>
                                transition.mutate({
                                  id: selected.id,
                                  status: "ACTIVE",
                                })
                              }
                            >
                              {t("accept")}
                            </Button>
                          ) : null}
                          {nextActions(selected.status).includes("REJECTED") ? (
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              disabled={transition.isPending}
                              onClick={() =>
                                transition.mutate({
                                  id: selected.id,
                                  status: "REJECTED",
                                })
                              }
                            >
                              {t("reject")}
                            </Button>
                          ) : null}
                        </Stack>
                        {nextActions(selected.status).includes("SUPERSEDED") ? (
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            spacing={1}
                            alignItems={{ sm: "center" }}
                          >
                            <TextField
                              select
                              size="small"
                              label={t("supersedeWith")}
                              value={supersedeWith}
                              onChange={(e) => setSupersedeWith(e.target.value)}
                              sx={{ minWidth: 220, flex: 1 }}
                            >
                              {successorOptions.length === 0 ? (
                                <MenuItem value="" disabled>
                                  {t("noSuccessor")}
                                </MenuItem>
                              ) : (
                                successorOptions.map((d) => (
                                  <MenuItem key={d.id} value={d.id}>
                                    {t(`status.${d.status}`)} · {d.decision.slice(0, 60)}
                                  </MenuItem>
                                ))
                              )}
                            </TextField>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={
                                transition.isPending || !supersedeWith
                              }
                              onClick={() =>
                                transition.mutate({
                                  id: selected.id,
                                  status: "SUPERSEDED",
                                  supersededBy: supersedeWith,
                                })
                              }
                            >
                              {t("supersede")}
                            </Button>
                          </Stack>
                        ) : null}
                        {transition.isError ? (
                          <Alert severity="error">
                            {(transition.error as Error).message}
                          </Alert>
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {t("terminalState")}
                      </Typography>
                    )}
                  </Stack>
                ) : null}
              </Box>
            );
          })
        )}
      </Stack>
    </Stack>
  );
}
