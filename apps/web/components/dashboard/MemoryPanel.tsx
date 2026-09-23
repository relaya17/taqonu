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
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { isActiveMemory } from "@/lib/memory-active";
import { memoryProvenanceLine } from "@/lib/memory-provenance";

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
  supersededBy?: string | null;
  cloudSynced?: boolean;
  source?: string | null;
  sourceType?: string | null;
  confidence?: number | null;
  evidence?: readonly unknown[] | null;
  verifiedBy?: string | null;
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
  onCorrect,
  onErase,
  approving,
  erasing,
  correcting,
  draft,
  onDraftChange,
  onSaveCorrection,
  onCancelCorrect,
  savingCorrection,
}: {
  item: Memory;
  onApprove?: (item: Memory) => void;
  onCorrect?: (item: Memory) => void;
  onErase?: (item: Memory) => void;
  approving: boolean;
  erasing: boolean;
  correcting: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSaveCorrection: () => void;
  onCancelCorrect: () => void;
  savingCorrection: boolean;
}) {
  const t = useTranslations("memory");
  return (
    <Box
      sx={{
        py: 2,
        borderBottom: "1px solid rgba(26,31,42,0.12)",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="center"
        flexWrap="wrap"
        sx={{ mb: 0.5, gap: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <EpistemicChip state={item.epistemicState} />
          <Typography variant="body2" color="text.secondary">
            {item.type} · {item.priority}
          </Typography>
          {(() => {
            const provenance = memoryProvenanceLine(item);
            return (
              <Typography variant="caption" color="text.secondary">
                {t("provenance", {
                  sourceType: provenance.sourceType,
                  source: provenance.source,
                  evidence: provenance.evidenceCount,
                  confidence:
                    provenance.confidence === null
                      ? "—"
                      : String(provenance.confidence),
                })}
                {provenance.verified ? ` · ${t("verified")}` : ""}
              </Typography>
            );
          })()}
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
        {onCorrect && !correcting ? (
          <Button
            size="small"
            variant="outlined"
            disabled={savingCorrection}
            onClick={() => onCorrect(item)}
          >
            {t("correct")}
          </Button>
        ) : null}
        {onErase ? (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={erasing}
            onClick={() => onErase(item)}
          >
            {t("erase")}
          </Button>
        ) : null}
      </Stack>
      {correcting ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <TextField
            label={t("statement")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <Stack direction="row" spacing={1} justifyContent="center">
            <Button
              size="small"
              variant="contained"
              disabled={savingCorrection || draft.trim().length < 3}
              onClick={onSaveCorrection}
            >
              {t("saveCorrection")}
            </Button>
            <Button size="small" disabled={savingCorrection} onClick={onCancelCorrect}>
              {t("cancelCorrect")}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Typography fontWeight={650}>{item.statement}</Typography>
      )}
    </Box>
  );
}

export function MemoryPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("memory");
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState("");
  const [type, setType] = useState("PREFERENCE");
  const [projectId, setProjectId] = useState("");
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [ttlHours, setTtlHours] = useState("");

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
    mutationFn: () => {
      const hours = Number(ttlHours);
      const validUntil =
        Number.isFinite(hours) && hours > 0
          ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
          : undefined;
      return apiPost<Memory>("/api/v1/memory", {
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
        ...(validUntil ? { validUntil } : {}),
      });
    },
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

  const erase = useMutation({
    mutationFn: (item: Memory) => apiDelete(`/api/v1/memory/${item.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      await queryClient.invalidateQueries({ queryKey: ["memory-pending"] });
    },
  });

  const correct = useMutation({
    mutationFn: (item: Memory) =>
      apiPost<Memory>(`/api/v1/memory/${item.id}/correct`, {
        statement: correctionDraft.trim(),
      }),
    onSuccess: async () => {
      setCorrectingId(null);
      setCorrectionDraft("");
      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      await queryClient.invalidateQueries({ queryKey: ["memory-pending"] });
    },
  });

  const items = (memoryQuery.data?.items ?? []).filter(isActiveMemory);
  const pendingItems = (pendingQuery.data?.items ?? []).filter(isActiveMemory);
  const pendingIds = new Set(pendingItems.map((p) => p.id));
  const confirmedItems = items.filter(
    (item) => !pendingIds.has(item.id) && !PENDING_STATES.has(item.epistemicState),
  );
  const projects = projectsQuery.data?.items ?? [];

  return (
    <Stack
      spacing={embedded ? 3 : 4}
      sx={{
        maxWidth: embedded ? "100%" : 820,
        width: "100%",
        mx: "auto",
        textAlign: "center",
        alignItems: "center",
      }}
    >
      {!embedded ? (
        <Box>
          <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
            {t("title")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("subtitle")}
          </Typography>
        </Box>
      ) : null}

      <Stack spacing={1.5} sx={{ width: "100%", alignItems: "center" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ width: "100%" }}
        >
          <TextField
            select
            fullWidth
            label={t("type")}
            value={type}
            onChange={(e) => setType(e.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
          >
            {["PREFERENCE", "DECISION", "LESSON", "FACT", "GOAL"].map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            label={t("project")}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
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
        <TextField
          label={t("ttlHours")}
          value={ttlHours}
          onChange={(e) => setTtlHours(e.target.value)}
          type="number"
          inputProps={{ min: 0, step: 1 }}
          fullWidth
          helperText={t("ttlHelp")}
        />
        <Button
          variant="contained"
          disabled={create.isPending || statement.trim().length < 3}
          onClick={() => create.mutate()}
          sx={{ alignSelf: "center", minWidth: 180 }}
        >
          {t("save")}
        </Button>
        <Button
          variant="outlined"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const dump = await apiGet<{ items: Memory[]; exportedAt: string }>(
                "/api/v1/memory/export",
              );
              const blob = new Blob([JSON.stringify(dump, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `atlas-memory-${dump.exportedAt.slice(0, 10)}.json`;
              link.click();
              URL.revokeObjectURL(url);
            } finally {
              setExporting(false);
            }
          }}
          sx={{ alignSelf: "center", minWidth: 180 }}
        >
          {t("export")}
        </Button>
        {create.isError ? (
          <Alert severity="error">{(create.error as Error).message}</Alert>
        ) : null}
        {memoryQuery.isError ? (
          <Alert severity="error">{(memoryQuery.error as Error).message}</Alert>
        ) : null}
        {pendingQuery.isError ? (
          <Alert severity="error">{(pendingQuery.error as Error).message}</Alert>
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
        {correct.isError ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {(correct.error as Error).message}
          </Alert>
        ) : null}
        {erase.isError ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {(erase.error as Error).message}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("correctHelp")}
        </Typography>
        <Stack spacing={0}>
          {pendingItems.length === 0 ? (
            <Typography color="text.secondary">{t("pendingEmpty")}</Typography>
          ) : (
            pendingItems.map((item) => (
              <MemoryRow
                key={item.id}
                item={item}
                approving={approve.isPending}
                erasing={erase.isPending}
                onApprove={(m) => approve.mutate(m)}
                onErase={(m) => erase.mutate(m)}
                onCorrect={(m) => {
                  setCorrectingId(m.id);
                  setCorrectionDraft(m.statement);
                }}
                correcting={correctingId === item.id}
                draft={correctionDraft}
                onDraftChange={setCorrectionDraft}
                onSaveCorrection={() => correct.mutate(item)}
                onCancelCorrect={() => {
                  setCorrectingId(null);
                  setCorrectionDraft("");
                }}
                savingCorrection={correct.isPending}
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
              <MemoryRow
                key={item.id}
                item={item}
                approving={false}
                erasing={erase.isPending}
                onErase={(m) => erase.mutate(m)}
                onCorrect={(m) => {
                  setCorrectingId(m.id);
                  setCorrectionDraft(m.statement);
                }}
                correcting={correctingId === item.id}
                draft={correctionDraft}
                onDraftChange={setCorrectionDraft}
                onSaveCorrection={() => correct.mutate(item)}
                onCancelCorrect={() => {
                  setCorrectingId(null);
                  setCorrectionDraft("");
                }}
                savingCorrection={correct.isPending}
              />
            ))
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

