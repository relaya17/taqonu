"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";
import { useColorMode } from "@/components/providers/ColorModeProvider";

interface Project {
  id: string;
  name: string;
  slug: string;
  workspaceRoot?: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  size?: number;
  children?: TreeNode[];
}

interface TreeResponse {
  projectId: string | null;
  root: string;
  tree: TreeNode;
  truncated: boolean;
  entryCount: number;
  readOnly: true;
  note: string;
}

interface FileResponse {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  languageHint: string | null;
  readOnly: true;
  note: string;
}

interface AskResult {
  patch: { id: string; title: string; status: string } | null;
  note: string;
}

type StudioIntent = "propose" | "remind" | "summary";
const ASK_MODES = ["fix", "generate", "implement", "refactor", "secure"] as const;

function TreeBranch({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, kind: "dir" | "file") => void;
}): ReactNode {
  const [open, setOpen] = useState(depth < 2);
  const theme = useTheme();
  if (node.kind === "file") {
    return (
      <ListItemButton
        dense
        selected={selectedPath === node.path}
        onClick={() => onSelect(node.path, "file")}
        sx={{
          pl: 1.5 + depth * 1.25,
          borderRadius: 1.5,
          mx: 0.5,
          "&.Mui-selected": {
            bgcolor:
              theme.palette.mode === "dark"
                ? "rgba(126,184,185,0.18)"
                : "rgba(15,61,62,0.1)",
          },
        }}
      >
        <ListItemText
          primary={node.name}
          primaryTypographyProps={{ fontSize: 13, noWrap: true }}
        />
      </ListItemButton>
    );
  }
  return (
    <Box>
      <ListItemButton
        dense
        onClick={() => setOpen((v) => !v)}
        sx={{ pl: 1.5 + depth * 1.25, borderRadius: 1.5, mx: 0.5 }}
      >
        <ListItemText
          primary={`${open ? "▾" : "▸"} ${node.name || "/"}`}
          primaryTypographyProps={{
            fontSize: 13,
            fontWeight: 650,
            noWrap: true,
          }}
        />
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List dense disablePadding>
          {(node.children ?? []).map((child) => (
            <TreeBranch
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </List>
      </Collapse>
    </Box>
  );
}

export default function StudioPage() {
  const t = useTranslations("studio");
  const theme = useTheme();
  const { mode, toggleMode } = useColorMode();
  const dark = mode === "dark";

  const [projectId, setProjectId] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [intent, setIntent] = useState<StudioIntent>("propose");
  const [modeAsk, setModeAsk] = useState<(typeof ASK_MODES)[number]>("fix");

  const panelBorder =
    theme.palette.mode === "dark"
      ? "1px solid rgba(232,240,240,0.12)"
      : "1px solid rgba(20,32,34,0.12)";
  const panelBg =
    theme.palette.mode === "dark"
      ? "rgba(19,32,34,0.92)"
      : "rgba(247,250,248,0.92)";
  const codeBg =
    theme.palette.mode === "dark"
      ? "rgba(8,16,17,0.9)"
      : "rgba(15,61,62,0.05)";

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;
  const hasRoot = Boolean(selectedProject?.workspaceRoot);

  const treeQuery = useQuery({
    queryKey: ["studio-tree", projectId],
    enabled: Boolean(projectId) && hasRoot,
    queryFn: () =>
      apiGet<TreeResponse>(
        `/api/v1/studio/tree?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const fileQuery = useQuery({
    queryKey: ["studio-file", projectId, selectedPath],
    enabled: Boolean(projectId) && Boolean(selectedPath) && hasRoot,
    queryFn: () =>
      apiGet<FileResponse>(
        `/api/v1/studio/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(selectedPath!)}`,
      ),
  });

  const propose = useMutation({
    mutationFn: () =>
      apiPost<AskResult>("/api/v1/studio/ask-agent", {
        projectId: projectId || null,
        path: selectedPath ?? undefined,
        mode: modeAsk,
        instruction,
      }),
  });

  const saveNote = useMutation({
    mutationFn: async () => {
      const focus = selectedPath ? ` [${selectedPath}]` : "";
      const prefix =
        intent === "remind" ? t("memoryRemindPrefix") : t("memorySummaryPrefix");
      return apiPost("/api/v1/memory", {
        type: intent === "remind" ? "TASK" : "DECISION",
        projectId: projectId || null,
        statement: `${prefix}${focus}: ${instruction.trim()}`,
        category: "DECISION_MEMORY",
        epistemicState: "CONFIRMED",
        observationMode: "CONFIRMED",
        source: "studio",
        sourceType: "USER",
        scope: projectId ? "PROJECT" : "GLOBAL",
        priority: intent === "remind" ? "MEDIUM" : "HIGH",
        confidence: 1,
      });
    },
  });

  const submit = () => {
    if (intent === "propose") propose.mutate();
    else saveNote.mutate();
  };

  const busy = propose.isPending || saveNote.isPending;
  const resultNote =
    intent === "propose"
      ? propose.data?.note
      : saveNote.isSuccess
        ? t(intent === "remind" ? "remindSaved" : "summarySaved")
        : null;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1240, width: "100%", minWidth: 0 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "flex-start" }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: "1.75rem", md: "2.35rem" } }}
          >
            {t("title")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>
            {t("subtitle")}
          </Typography>
        </Box>
        <Tooltip title={dark ? t("themeLight") : t("themeDark")}>
          <IconButton
            onClick={toggleMode}
            aria-label={dark ? t("themeLight") : t("themeDark")}
            sx={{
              border: panelBorder,
              bgcolor: panelBg,
              alignSelf: { xs: "flex-start", sm: "center" },
            }}
          >
            {dark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Alert
        severity="info"
        sx={{
          borderRadius: 2,
          bgcolor: dark ? "rgba(126,184,185,0.08)" : undefined,
        }}
      >
        {t("agentPolicy")}
      </Alert>

      <TextField
        select
        label={t("project")}
        value={projectId}
        onChange={(e) => {
          setProjectId(e.target.value);
          setSelectedPath(null);
          propose.reset();
          saveNote.reset();
        }}
        helperText={t("projectHelp")}
        sx={{ maxWidth: 480 }}
      >
        {projects.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.workspaceRoot ? "" : ` (${t("noRoot")})`}
          </MenuItem>
        ))}
      </TextField>

      {projectId && !hasRoot ? (
        <Alert severity="warning">
          {t("needRoot")}{" "}
          <Link href="/projects">{t("goProjects")}</Link>
        </Alert>
      ) : null}

      {treeQuery.isError ? (
        <Alert severity="error">{(treeQuery.error as Error).message}</Alert>
      ) : null}

      {projectId && hasRoot ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "300px 1fr" },
            alignItems: "stretch",
            minHeight: { md: 560 },
          }}
        >
          <Box
            sx={{
              border: panelBorder,
              borderRadius: 3,
              overflow: "auto",
              maxHeight: { xs: 300, md: 680 },
              bgcolor: panelBg,
              boxShadow: dark
                ? "0 12px 40px rgba(0,0,0,0.35)"
                : "0 10px 30px rgba(15,61,62,0.08)",
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                px: 1.5,
                py: 1.25,
                borderBottom: panelBorder,
                position: "sticky",
                top: 0,
                bgcolor: panelBg,
                zIndex: 1,
              }}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                {t("tree")}
              </Typography>
              {treeQuery.data?.truncated ? (
                <Chip size="small" label={t("truncated")} />
              ) : null}
              <Chip size="small" variant="outlined" label={t("readOnly")} />
            </Stack>
            {treeQuery.data ? (
              <List dense disablePadding sx={{ py: 0.75 }}>
                <TreeBranch
                  node={treeQuery.data.tree}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={(path, kind) => {
                    if (kind === "file") setSelectedPath(path);
                  }}
                />
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {treeQuery.isLoading ? t("loadingTree") : t("emptyTree")}
              </Typography>
            )}
          </Box>

          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <Box
              sx={{
                border: panelBorder,
                borderRadius: 3,
                overflow: "hidden",
                flex: 1,
                minHeight: 300,
                display: "flex",
                flexDirection: "column",
                bgcolor: panelBg,
                boxShadow: dark
                  ? "0 12px 40px rgba(0,0,0,0.35)"
                  : "0 10px 30px rgba(15,61,62,0.08)",
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 1.5, py: 1.25, borderBottom: panelBorder }}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  noWrap
                  sx={{ flex: 1 }}
                >
                  {selectedPath ?? t("pickFile")}
                </Typography>
                <Chip size="small" label={t("noEdit")} />
              </Stack>
              {fileQuery.isError ? (
                <Alert severity="warning" sx={{ m: 1.5 }}>
                  {(fileQuery.error as Error).message}
                </Alert>
              ) : null}
              {fileQuery.data ? (
                <Box
                  component="pre"
                  aria-readonly="true"
                  sx={{
                    m: 0,
                    p: 2,
                    flex: 1,
                    overflow: "auto",
                    maxHeight: 440,
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    userSelect: "text",
                    bgcolor: codeBg,
                    color: "text.primary",
                  }}
                >
                  {fileQuery.data.content}
                  {fileQuery.data.truncated ? `\n\n… ${t("fileTruncated")}` : ""}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                  {selectedPath && fileQuery.isLoading
                    ? t("loadingFile")
                    : t("viewerHint")}
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                border: panelBorder,
                borderRadius: 3,
                p: 2.25,
                bgcolor: panelBg,
                boxShadow: dark
                  ? "0 12px 40px rgba(0,0,0,0.28)"
                  : "0 10px 30px rgba(15,61,62,0.06)",
              }}
            >
              <Typography fontWeight={700}>{t("askTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t("askHelp")}
              </Typography>

              <ToggleButtonGroup
                exclusive
                size="small"
                value={intent}
                onChange={(_, v: StudioIntent | null) => {
                  if (v) {
                    setIntent(v);
                    propose.reset();
                    saveNote.reset();
                  }
                }}
                sx={{ mt: 1.75, flexWrap: "wrap", gap: 0.5 }}
                aria-label={t("intentLabel")}
              >
                <ToggleButton value="propose">{t("intentPropose")}</ToggleButton>
                <ToggleButton value="remind">{t("intentRemind")}</ToggleButton>
                <ToggleButton value="summary">{t("intentSummary")}</ToggleButton>
              </ToggleButtonGroup>

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {t(`intentHelp.${intent}`)}
              </Typography>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ mt: 1.75 }}
              >
                {intent === "propose" ? (
                  <TextField
                    select
                    size="small"
                    label={t("mode")}
                    value={modeAsk}
                    onChange={(e) =>
                      setModeAsk(e.target.value as (typeof ASK_MODES)[number])
                    }
                    sx={{ minWidth: 160 }}
                  >
                    {ASK_MODES.map((m) => (
                      <MenuItem key={m} value={m}>
                        {t(`modes.${m}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                <TextField
                  size="small"
                  fullWidth
                  multiline={intent !== "propose"}
                  minRows={intent === "propose" ? 1 : 2}
                  label={
                    intent === "propose"
                      ? t("instruction")
                      : intent === "remind"
                        ? t("remindLabel")
                        : t("summaryLabel")
                  }
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    intent === "propose"
                      ? t("instructionPlaceholder")
                      : intent === "remind"
                        ? t("remindPlaceholder")
                        : t("summaryPlaceholder")
                  }
                />
                <Button
                  variant="contained"
                  disabled={busy || instruction.trim().length < 3}
                  onClick={submit}
                  sx={{ whiteSpace: "nowrap", alignSelf: { sm: "flex-start" } }}
                >
                  {busy
                    ? t("asking")
                    : intent === "propose"
                      ? t("ask")
                      : intent === "remind"
                        ? t("saveRemind")
                        : t("saveSummary")}
                </Button>
              </Stack>

              {(propose.isError || saveNote.isError) && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {(
                    (propose.error || saveNote.error) as Error
                  ).message}
                </Alert>
              )}
              {resultNote ? (
                <Alert
                  severity={
                    intent === "propose" && !propose.data?.patch
                      ? "info"
                      : "success"
                  }
                  sx={{ mt: 1.5 }}
                >
                  {resultNote}
                  {intent === "propose" && propose.data?.patch ? (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        component={Link}
                        href="/patches"
                        size="small"
                        variant="outlined"
                      >
                        {t("openPatches")}
                      </Button>
                    </Box>
                  ) : null}
                  {intent !== "propose" ? (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        component={Link}
                        href="/memory"
                        size="small"
                        variant="outlined"
                      >
                        {t("openMemory")}
                      </Button>
                    </Box>
                  ) : null}
                </Alert>
              ) : null}
            </Box>
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}
