"use client";

import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/api";

/**
 * Type-aware actions against the TypeScript language service.
 * Not regex. Not an LLM. Rename apply is a human workspace write.
 */
export function StudioLanguageBar({
  projectId,
  path,
  content,
  onOpen,
}: {
  projectId: string;
  path: string;
  content: string;
  onOpen: (path: string, line: number | null) => void;
}) {
  const t = useTranslations("studio");
  const [line, setLine] = useState(1);
  const [column, setColumn] = useState(1);
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const unsaved = { path, content };

  const hover = useMutation({
    mutationFn: () =>
      apiPost<{ hover: { display: string; documentation: string } | null }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/language/hover`,
        { path, line, column, unsaved },
      ),
    onSuccess: (data) => setNote(data.hover?.display ?? t("outlineEmpty")),
  });
  const definition = useMutation({
    mutationFn: () =>
      apiPost<{ location: { path: string; line: number } | null }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/language/definition`,
        { path, line, column, unsaved },
      ),
    onSuccess: (data) => {
      if (data.location) onOpen(data.location.path, data.location.line);
      else setNote(t("outlineEmpty"));
    },
  });
  const references = useMutation({
    mutationFn: () =>
      apiPost<{ references: Array<{ path: string; line: number }> }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/language/references`,
        { path, line, column, unsaved },
      ),
    onSuccess: (data) => {
      const first = data.references[0];
      setNote(`${data.references.length}`);
      if (first) onOpen(first.path, first.line);
    },
  });
  const rename = useMutation({
    mutationFn: () =>
      apiPost<{ applied: boolean; written?: string[] }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/language/rename`,
        { path, line, column, newName, apply: true, unsaved },
      ),
    onSuccess: (data) => setNote(data.applied ? (data.written ?? []).join(", ") : ""),
  });

  return (
    <Stack spacing={1} sx={{ px: 1.5, py: 1, borderBottom: "1px solid rgba(232,234,238,0.12)" }}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField
          size="small"
          type="number"
          label="line"
          value={line}
          onChange={(event) => setLine(Number(event.target.value) || 1)}
          sx={{ width: 88 }}
        />
        <TextField
          size="small"
          type="number"
          label="col"
          value={column}
          onChange={(event) => setColumn(Number(event.target.value) || 1)}
          sx={{ width: 88 }}
        />
        <Button size="small" onClick={() => hover.mutate()}>
          hover
        </Button>
        <Button size="small" onClick={() => definition.mutate()}>
          definition
        </Button>
        <Button size="small" onClick={() => references.mutate()}>
          references
        </Button>
        <TextField
          size="small"
          label="rename"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          sx={{ width: 140 }}
        />
        <Button size="small" disabled={!newName.trim()} onClick={() => rename.mutate()}>
          rename
        </Button>
      </Stack>
      {note ? (
        <Typography variant="caption" sx={{ color: "#8B9099", whiteSpace: "pre-wrap" }}>
          {note}
        </Typography>
      ) : null}
      {hover.isError || definition.isError || references.isError || rename.isError ? (
        <Alert severity="warning">
          {(hover.error as Error | undefined)?.message ||
            (definition.error as Error | undefined)?.message ||
            (references.error as Error | undefined)?.message ||
            (rename.error as Error | undefined)?.message}
        </Alert>
      ) : null}
    </Stack>
  );
}
