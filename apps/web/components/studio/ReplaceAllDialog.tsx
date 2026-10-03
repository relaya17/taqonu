"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/api";

interface ReplaceHit {
  path: string;
  line: number;
  preview: string;
  nextPreview: string;
}

interface ReplacePreview {
  query: string;
  replacement: string;
  items: ReplaceHit[];
  blocked: string[];
  truncated: boolean;
}

interface ReplaceApplyResult {
  written: { path: string; bytes: number; replacements: number }[];
  skipped: string[];
}

/** API limits (apps/api/src/routes/studio-replace.ts). */
const MIN_QUERY = 2;
const MAX_QUERY = 80;
const MAX_REPLACEMENT = 200;
const MAX_PATHS = 40;

const srOnly = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/**
 * Project-wide find/replace. Exact, case-sensitive string match only (the
 * API has no regex/case/glob options). Preview is read-only; Apply writes the
 * selected files through the workspace write path and never touches .env.
 */
export function ReplaceAllDialog({
  projectId,
  open,
  onClose,
  onApplied,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const t = useTranslations("replaceAll");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const preview = useMutation({
    mutationFn: () =>
      apiPost<ReplacePreview>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/replace/preview`,
        { query: find, replacement: replace },
      ),
    onSuccess: (data) => {
      const paths = [...new Set(data.items.map((h) => h.path))];
      setSelected(paths.slice(0, MAX_PATHS));
      setConfirming(false);
      apply.reset();
    },
  });

  const apply = useMutation({
    mutationFn: () => {
      const data = preview.data;
      return apiPost<ReplaceApplyResult>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/replace/apply`,
        {
          query: data?.query ?? find,
          replacement: data?.replacement ?? replace,
          paths: selected,
        },
      );
    },
    onSuccess: () => {
      setConfirming(false);
      onApplied?.();
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ReplaceHit[]>();
    for (const hit of preview.data?.items ?? []) {
      const list = map.get(hit.path) ?? [];
      list.push(hit);
      map.set(hit.path, list);
    }
    return [...map.entries()];
  }, [preview.data]);

  const totalMatches = preview.data?.items.length ?? 0;
  const queryValid = find.trim().length >= MIN_QUERY;
  const previewStale =
    Boolean(preview.data) &&
    (preview.data?.replacement !== replace || preview.data?.query !== find.trim());

  const togglePath = (path: string) =>
    setSelected((prev) =>
      prev.includes(path)
        ? prev.filter((p) => p !== path)
        : prev.length >= MAX_PATHS
          ? prev
          : [...prev, path],
    );

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md" aria-labelledby="replace-all-title">
      <DialogTitle id="replace-all-title">{t("title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {t("help")}
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <TextField
            size="small"
            label={t("find")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            inputProps={{ maxLength: MAX_QUERY }}
            helperText={t("findHelp", { min: MIN_QUERY, max: MAX_QUERY })}
            autoFocus
          />
          <TextField
            size="small"
            label={t("replace")}
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            inputProps={{ maxLength: MAX_REPLACEMENT }}
          />
          <Typography variant="caption" color="text.secondary">
            {t("exactOnly")}
          </Typography>
          <Button
            variant="outlined"
            sx={{ alignSelf: "flex-start" }}
            disabled={!projectId || !queryValid || preview.isPending}
            onClick={() => preview.mutate()}
          >
            {preview.isPending ? t("previewing") : t("preview")}
          </Button>
          {!projectId ? <Alert severity="info">{t("noProject")}</Alert> : null}
          {preview.isError ? (
            <Alert severity="error">{(preview.error as Error).message}</Alert>
          ) : null}
        </Stack>

        {preview.data ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" component="h3">
              {t("summary", { matches: totalMatches, files: grouped.length })}
            </Typography>
            {preview.data.truncated ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t("truncated")}
              </Alert>
            ) : null}
            {preview.data.blocked.length > 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                {t("blocked", { files: preview.data.blocked.join(", ") })}
              </Alert>
            ) : null}
            {previewStale ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t("stale")}
              </Alert>
            ) : null}
            {grouped.length === 0 ? (
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {t("noMatches")}
              </Typography>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1, maxHeight: 360, overflow: "auto" }}>
                {grouped.length > MAX_PATHS ? (
                  <Alert severity="info">{t("pathLimit", { max: MAX_PATHS })}</Alert>
                ) : null}
                {grouped.map(([path, hits]) => (
                  <Box key={path}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={selected.includes(path)}
                          onChange={() => togglePath(path)}
                        />
                      }
                      label={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" fontWeight={600} sx={{ wordBreak: "break-all" }}>
                            {path}
                          </Typography>
                          <Chip size="small" label={t("matchCount", { count: hits.length })} />
                        </Stack>
                      }
                    />
                    <Stack spacing={0.5} sx={{ pl: 4 }}>
                      {hits.map((hit) => (
                        <Box key={`${hit.path}:${hit.line}`} sx={{ fontFamily: "monospace", fontSize: 12 }}>
                          <Typography variant="caption" color="text.secondary">
                            {t("line", { line: hit.line })}
                          </Typography>
                          <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            <span aria-hidden="true">− </span>
                            <Box component="span" sx={srOnly}>{t("before")}: </Box>
                            {hit.preview}
                          </Box>
                          <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            <span aria-hidden="true">+ </span>
                            <Box component="span" sx={srOnly}>{t("after")}: </Box>
                            {hit.nextPreview}
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        ) : null}

        {confirming ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t("confirm", { files: selected.length })}
          </Alert>
        ) : null}
        {apply.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(apply.error as Error).message}
          </Alert>
        ) : null}
        {apply.data ? (
          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="body2">
              {t("applied", {
                files: apply.data.written.length,
                replacements: apply.data.written.reduce((n, w) => n + w.replacements, 0),
              })}
            </Typography>
            {apply.data.skipped.length > 0 ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {t("skipped", { files: apply.data.skipped.join(", ") })}
              </Typography>
            ) : null}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("close")}</Button>
        {confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>{t("cancel")}</Button>
            <Button
              variant="contained"
              color="warning"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? t("applying") : t("confirmApply")}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            disabled={
              !preview.data ||
              previewStale ||
              selected.length === 0 ||
              apply.isPending ||
              Boolean(apply.data)
            }
            onClick={() => setConfirming(true)}
          >
            {t("apply", { files: selected.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
