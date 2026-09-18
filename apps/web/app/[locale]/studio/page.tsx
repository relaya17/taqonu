"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { EngineeringLoopRun } from "@atlas/shared";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";
import { ChatPanel } from "@/components/studio/ChatPanel";
import { CloudToolsPanel } from "@/components/studio/CloudToolsPanel";
import { ObserverPanel } from "@/components/studio/ObserverPanel";
import { SentinelPanel } from "@/components/studio/SentinelPanel";
import { QaPanel } from "@/components/studio/QaPanel";
import { ProcessAuditPanel } from "@/components/studio/ProcessAuditPanel";
import { HealthPanel } from "@/components/studio/HealthPanel";
import { ReadinessPanel } from "@/components/studio/ReadinessPanel";
import { TruthPanel } from "@/components/studio/TruthPanel";
import { StudioPatchWorkflow } from "@/components/studio/StudioPatchWorkflow";
import { SupervisingAgentPanel } from "@/components/studio/SupervisingAgentPanel";
import {
  STUDIO_CHECK_IDS,
  STUDIO_TABS,
  isStudioCheckId,
  isStudioTab,
  type StudioCheckId,
  type StudioTab,
} from "@/lib/studio-surfaces";

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
  readOnly: boolean;
  note: string;
}

interface FileResponse {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  languageHint: string | null;
  readOnly: boolean;
  note: string;
}

interface AskResult {
  patch: { id: string; title: string; status: string } | null;
  note: string;
  memoryUsed?: number;
}

interface ExemplarUnit {
  id: string;
  kind: string;
  title: string;
}

interface ExemplarItem {
  id: string;
  slug: string;
  title: string;
  visibility: "catalog" | "personal";
  completeness: Record<string, boolean>;
  units: ExemplarUnit[];
}

interface CloneResult {
  note: string;
  cloneReady: boolean;
  files: number;
  patch: { id: string } | null;
}

type StudioIntent = "propose" | "loop" | "remind" | "summary";
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
  if (node.kind === "file") {
    return (
      <ListItemButton
        dense
        selected={selectedPath === node.path}
        onClick={() => onSelect(node.path, "file")}
        sx={{
          ps: 1.5 + depth * 1.25,
          borderRadius: 1.5,
          mx: 0.5,
          color: "#DCDDE1",
          "&.Mui-selected": {
            bgcolor: "rgba(154,158,168,0.18)",
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
        sx={{ ps: 1.5 + depth * 1.25, borderRadius: 1.5, mx: 0.5, color: "#DCDDE1" }}
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

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const projectFromUrl = searchParams.get("project");
  const [tab, setTab] = useState<StudioTab>(
    isStudioTab(tabFromUrl) ? tabFromUrl : "files",
  );

  useEffect(() => {
    if (isStudioTab(tabFromUrl) && tabFromUrl !== tab) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl, tab]);

  const selectTab = (next: StudioTab) => {
    setTab(next);
    const projectQs = projectId ? `&project=${encodeURIComponent(projectId)}` : "";
    router.replace(
      next === "checks"
        ? `${pathname}?tab=${next}&check=${checksTab}${projectQs}`
        : `${pathname}?tab=${next}${projectQs}`,
    );
  };

  const checkFromUrl = searchParams.get("check");
  const [checksTab, setChecksTab] = useState<StudioCheckId>(
    isStudioCheckId(checkFromUrl) ? checkFromUrl : "observer",
  );

  useEffect(() => {
    if (isStudioCheckId(checkFromUrl) && checkFromUrl !== checksTab) {
      setChecksTab(checkFromUrl);
    }
  }, [checkFromUrl, checksTab]);

  const selectChecksTab = (next: StudioCheckId) => {
    setChecksTab(next);
    const projectQs = projectId ? `&project=${encodeURIComponent(projectId)}` : "";
    router.replace(`${pathname}?tab=checks&check=${next}${projectQs}`);
  };

  const [projectId, setProjectId] = useState(projectFromUrl ?? "");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (projectFromUrl) setProjectId(projectFromUrl);
  }, [projectFromUrl]);
  const [instruction, setInstruction] = useState("");
  const [intent, setIntent] = useState<StudioIntent>("propose");
  const [modeAsk, setModeAsk] = useState<(typeof ASK_MODES)[number]>("fix");
  const [draft, setDraft] = useState<string | null>(null);
  const [cloneUnitId, setCloneUnitId] = useState("WHOLE");

  // Studio-only dark surface — does not flip the rest of the app.
  const panelBorder = "1px solid rgba(232,234,238,0.12)";
  const panelBg = "rgba(28,31,38,0.92)";
  const codeBg = "rgba(14,17,22,0.9)";

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

  useEffect(() => {
    setDraft(fileQuery.data?.content ?? null);
  }, [fileQuery.data?.path, fileQuery.data?.content]);

  const exemplarsQuery = useQuery({
    queryKey: ["exemplars"],
    queryFn: () => apiGet<{ items: ExemplarItem[] }>("/api/v1/exemplars"),
  });

  const [exemplarId, setExemplarId] = useState("");
  const exemplars = exemplarsQuery.data?.items ?? [];
  const selectedExemplar =
    exemplars.find((item) => item.id === exemplarId) ?? exemplars[0] ?? null;

  const saveFile = useMutation({
    mutationFn: () =>
      apiPut("/api/v1/studio/file", {
        projectId,
        path: selectedPath,
        content: draft ?? "",
      }),
    onSuccess: () => {
      void fileQuery.refetch();
      void treeQuery.refetch();
    },
  });

  const cloneEx = useMutation({
    mutationFn: () =>
      apiPost<CloneResult>(
        `/api/v1/exemplars/${encodeURIComponent(selectedExemplar!.id)}/clone`,
        {
          projectId,
          unitId: cloneUnitId,
        },
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

  // Invokes the existing Engineering Loop (packages/engineering-loop via
  // POST /api/v1/engineering/loop) with the actual selected project's real,
  // linked workspaceRoot -- never a fallback. The surrounding panel only
  // renders when hasRoot is true (see the `projectId && hasRoot` gate
  // below), so this mutation cannot fire without a real linked folder; the
  // explicit check here is defense in depth, not the only guard.
  const runLoop = useMutation({
    mutationFn: () => {
      if (!selectedProject?.workspaceRoot) {
        throw new Error(t("loopNoRoot"));
      }
      return apiPost<EngineeringLoopRun>("/api/v1/engineering/loop", {
        workspaceRoot: selectedProject.workspaceRoot,
        userRequest: instruction,
        projectId,
        projectSlug: selectedProject.slug,
        mode: modeAsk,
      });
    },
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
    else if (intent === "loop") runLoop.mutate();
    else saveNote.mutate();
  };

  const busy = propose.isPending || runLoop.isPending || saveNote.isPending;
  const resultNote =
    intent === "propose"
      ? propose.data?.note
      : intent === "loop"
        ? runLoop.data
          ? `${t("loopStatusLabel")}: ${t(`loopStatusValue.${runLoop.data.status}`)}${
              runLoop.data.risk ? ` · ${t("loopRiskLabel")}: ${runLoop.data.risk}` : ""
            }`
          : null
        : saveNote.isSuccess
          ? t(intent === "remind" ? "remindSaved" : "summarySaved")
          : null;

  return (
    <Box
      sx={{
        mx: { xs: -2, sm: -3, md: -4 },
        px: { xs: 2, sm: 3, md: 4 },
        py: { xs: 2, md: 2.5 },
        minHeight: "70vh",
        borderRadius: { xs: 0, md: 3 },
        color: "#DCDDE1",
        textAlign: "start",
        background: `
          radial-gradient(900px 420px at 8% -10%, rgba(154,158,168,0.16), transparent 55%),
          linear-gradient(165deg, #12141A 0%, #16191F 50%, #1C1F26 100%)
        `,
      }}
    >
    <Stack spacing={2.5} sx={{ maxWidth: 1240, width: "100%", minWidth: 0 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "flex-start" }}
        justifyContent="flex-start"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: "1.75rem", md: "2.35rem" }, color: "#EEEEF0" }}
          >
            {t("title")}
          </Typography>
          <Typography sx={{ mt: 1, maxWidth: 640, color: "rgba(154,163,178,0.95)" }}>
            {t("subtitle")}
          </Typography>
        </Box>
      </Stack>

      <Alert
        severity="info"
        sx={{
          borderRadius: 2,
          bgcolor: "rgba(154,158,168,0.08)",
          color: "#DCDDE1",
          "& .MuiAlert-icon": { color: "#9A9EA8" },
        }}
      >
        {t("agentPolicy")}
      </Alert>

      <TextField
        select
        label={t("project")}
        value={projectId}
        onChange={(e) => {
          const id = e.target.value;
          setProjectId(id);
          setSelectedPath(null);
          propose.reset();
          saveNote.reset();
          const projectQs = id ? `&project=${encodeURIComponent(id)}` : "";
          router.replace(
            tab === "checks"
              ? `${pathname}?tab=${tab}&check=${checksTab}${projectQs}`
              : `${pathname}?tab=${tab}${projectQs}`,
          );
        }}
        helperText={t("projectHelp")}
        sx={{
          maxWidth: 480,
          "& .MuiOutlinedInput-root": {
            color: "#DCDDE1",
            bgcolor: "rgba(255,255,255,0.04)",
            "& fieldset": { borderColor: "rgba(232,234,238,0.2)" },
          },
          "& .MuiInputLabel-root": { color: "rgba(232,234,238,0.7)" },
          "& .MuiFormHelperText-root": { color: "#8B9099" },
        }}
      >
        {projects.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.workspaceRoot ? "" : ` (${t("noRoot")})`}
          </MenuItem>
        ))}
      </TextField>

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selectedProject?.workspaceRoot}
          compact
        />
      ) : null}

      {projectId && !hasRoot ? (
        <Alert severity="warning">
          {t("needRoot")}{" "}
          <Link href="/projects">{t("goProjects")}</Link>
        </Alert>
      ) : null}

      {projectsQuery.isError ? (
        <Alert severity="error">
          {(projectsQuery.error as Error).message}
        </Alert>
      ) : null}

      {!projectId && !projectsQuery.isLoading && projects.length === 0 ? (
        <Alert severity="info">
          {t("noProjects")}{" "}
          <Link href="/projects">{t("goProjects")}</Link>
        </Alert>
      ) : null}

      {!projectId && !projectsQuery.isLoading && projects.length > 0 ? (
        <Alert severity="info">{t("pickProject")}</Alert>
      ) : null}

      <Tabs
        value={tab}
        onChange={(_, v: StudioTab) => selectTab(v)}
        sx={{
          borderBottom: panelBorder,
          minHeight: 40,
          "& .MuiTab-root": {
            color: "rgba(232,234,238,0.65)",
            minHeight: 40,
            textTransform: "none",
          },
          "& .Mui-selected": { color: "#EEEEF0 !important" },
          "& .MuiTabs-indicator": { bgcolor: "#9A9EA8" },
        }}
      >
        {STUDIO_TABS.map((id) => (
          <Tab key={id} value={id} label={t(`tab.${id}`)} />
        ))}
      </Tabs>

      {tab === "files" ? (
        <>
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
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
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
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
                {t("tree")}
              </Typography>
              {treeQuery.data?.truncated ? (
                <Chip size="small" label={t("truncated")} />
              ) : null}
              <Chip size="small" variant="outlined" label={t("editable")} sx={{ color: "#8B9099", borderColor: "rgba(232,234,238,0.25)" }} />
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
              <Typography variant="body2" sx={{ p: 2, color: "#8B9099" }}>
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
                boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
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
                <Chip
                  size="small"
                  label={
                    fileQuery.data?.truncated
                      ? t("fileTruncated")
                      : draft !== null &&
                          fileQuery.data &&
                          draft !== fileQuery.data.content
                        ? t("dirty")
                        : t("editable")
                  }
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    saveFile.isPending ||
                    !selectedPath ||
                    draft === null ||
                    Boolean(fileQuery.data?.truncated) ||
                    Boolean(fileQuery.data?.readOnly) ||
                    draft === fileQuery.data?.content
                  }
                  onClick={() => saveFile.mutate()}
                >
                  {saveFile.isPending ? t("asking") : t("saveFile")}
                </Button>
              </Stack>
              {fileQuery.isError ? (
                <Alert severity="warning" sx={{ m: 1.5 }}>
                  {(fileQuery.error as Error).message}
                </Alert>
              ) : null}
              {saveFile.isError ? (
                <Alert severity="error" sx={{ m: 1.5 }}>
                  {(saveFile.error as Error).message}
                </Alert>
              ) : null}
              {saveFile.isSuccess ? (
                <Alert severity="success" sx={{ m: 1.5 }}>
                  {t("savedFile")}
                </Alert>
              ) : null}
              {fileQuery.data ? (
                <Box
                  component="textarea"
                  value={draft ?? ""}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={
                    Boolean(fileQuery.data.truncated) ||
                    fileQuery.data.readOnly
                  }
                  spellCheck={false}
                  aria-label={selectedPath ?? t("pickFile")}
                  sx={{
                    m: 0,
                    p: 2,
                    flex: 1,
                    overflow: "auto",
                    maxHeight: 440,
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    bgcolor: codeBg,
                    color: "#DCDDE1",
                    border: 0,
                    resize: "vertical",
                    outline: "none",
                  }}
                />
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
                boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>{t("askTitle")}</Typography>
                <Chip size="small" label={t("engineerRole")} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5, color: "#8B9099" }}>
                {t("askHelp")}
              </Typography>
              <Typography variant="caption" sx={{ color: "#8B9099", display: "block", mt: 0.5 }}>
                {t("engineerNotPsa")}
              </Typography>

              <ToggleButtonGroup
                exclusive
                size="small"
                value={intent}
                onChange={(_, v: StudioIntent | null) => {
                  if (v) {
                    setIntent(v);
                    propose.reset();
                    runLoop.reset();
                    saveNote.reset();
                  }
                }}
                sx={{ mt: 1.75, flexWrap: "wrap", gap: 0.5 }}
                aria-label={t("intentLabel")}
              >
                <ToggleButton value="propose">{t("intentPropose")}</ToggleButton>
                <ToggleButton value="loop">{t("intentLoop")}</ToggleButton>
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
                {intent === "propose" || intent === "loop" ? (
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
                  multiline={intent !== "propose" && intent !== "loop"}
                  minRows={intent === "propose" || intent === "loop" ? 1 : 2}
                  label={
                    intent === "propose" || intent === "loop"
                      ? t("instruction")
                      : intent === "remind"
                        ? t("remindLabel")
                        : t("summaryLabel")
                  }
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    intent === "propose" || intent === "loop"
                      ? t("instructionPlaceholder")
                      : intent === "remind"
                        ? t("remindPlaceholder")
                        : t("summaryPlaceholder")
                  }
                />
                <Button
                  variant="contained"
                  disabled={
                    busy ||
                    instruction.trim().length < 3 ||
                    (intent === "loop" && !hasRoot)
                  }
                  onClick={submit}
                  sx={{ whiteSpace: "nowrap", alignSelf: { sm: "flex-start" } }}
                >
                  {busy
                    ? intent === "loop"
                      ? t("loopRunning")
                      : t("asking")
                    : intent === "propose"
                      ? t("ask")
                      : intent === "loop"
                        ? t("runLoop")
                        : intent === "remind"
                          ? t("saveRemind")
                          : t("saveSummary")}
                </Button>
              </Stack>

              {(propose.isError || runLoop.isError || saveNote.isError) && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {(
                    (propose.error || runLoop.error || saveNote.error) as Error
                  ).message}
                </Alert>
              )}
              {resultNote ? (
                <Alert
                  severity={
                    (intent === "propose" && !propose.data?.patch) ||
                    (intent === "loop" && runLoop.data?.status !== "APPLIED")
                      ? "info"
                      : "success"
                  }
                  sx={{ mt: 1.5 }}
                >
                  {resultNote}
                  {intent === "propose" && typeof propose.data?.memoryUsed === "number"
                    ? ` (${t("memoryHint")}: ${propose.data.memoryUsed})`
                    : null}
                  {intent !== "propose" && intent !== "loop" ? (
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

            <SupervisingAgentPanel projectId={projectId} />

            <StudioPatchWorkflow
              projectId={projectId}
              workspaceRoot={selectedProject?.workspaceRoot}
              focusPatchId={propose.data?.patch?.id ?? runLoop.data?.patchId ?? null}
              onVerified={() => {
                void fileQuery.refetch();
                void treeQuery.refetch();
              }}
            />

            <Box
              sx={{
                border: panelBorder,
                borderRadius: 3,
                p: 2.25,
                bgcolor: panelBg,
                boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
              }}
            >
              <Typography fontWeight={700} sx={{ color: "#DCDDE1" }}>
                {t("cloneTitle")}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: "#8B9099" }}>
                {t("cloneHelp")}
              </Typography>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ mt: 1.75 }}
              >
                <TextField
                  select
                  size="small"
                  label={t("catalog")}
                  value={selectedExemplar?.id ?? ""}
                  onChange={(e) => {
                    setExemplarId(e.target.value);
                    setCloneUnitId("WHOLE");
                  }}
                  sx={{ minWidth: 220 }}
                >
                  {exemplars.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.title}
                      {item.visibility === "personal"
                        ? ` (${t("personalExemplars")})`
                        : ""}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t("cloneUnit")}
                  value={cloneUnitId}
                  onChange={(e) => setCloneUnitId(e.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="WHOLE">{t("cloneWhole")}</MenuItem>
                  {(selectedExemplar?.units ?? [])
                    .filter((u) => u.kind !== "WHOLE")
                    .map((unit) => (
                      <MenuItem key={unit.id} value={unit.id}>
                        {unit.title}
                      </MenuItem>
                    ))}
                </TextField>
                <Button
                  variant="outlined"
                  disabled={!selectedExemplar || cloneEx.isPending || !projectId}
                  onClick={() => cloneEx.mutate()}
                >
                  {cloneEx.isPending ? t("cloning") : t("cloneAction")}
                </Button>
              </Stack>
              {exemplarsQuery.isError ? (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  {(exemplarsQuery.error as Error).message}
                </Alert>
              ) : null}
              {selectedExemplar ? (
                <Typography variant="caption" sx={{ mt: 1, display: "block", color: "#8B9099" }}>
                  {Object.values(selectedExemplar.completeness).every(Boolean)
                    ? t("cloneReady")
                    : t("cloneNotReady")}
                </Typography>
              ) : null}
              {cloneEx.isError ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {(cloneEx.error as Error).message}
                </Alert>
              ) : null}
              {cloneEx.data ? (
                <Alert severity="success" sx={{ mt: 1.5 }}>
                  {t("cloneDone")} {cloneEx.data.note}
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
                </Alert>
              ) : null}
            </Box>
          </Stack>
        </Box>
      ) : null}
        </>
      ) : null}

      {tab === "chat" ? (
        projectId ? (
          <ChatPanel projectId={projectId} selectedPath={selectedPath} embedded />
        ) : (
          <Alert severity="info">{t("pickProject")}</Alert>
        )
      ) : null}

      {tab === "cloud" ? <CloudToolsPanel embedded /> : null}

      {tab === "checks" ? (
          <Stack spacing={2}>
            {!projectId ? <Alert severity="info">{t("pickProject")}</Alert> : null}
            <Tabs
              value={checksTab}
              onChange={(_, v: StudioCheckId) => selectChecksTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                borderBottom: panelBorder,
                minHeight: 36,
                "& .MuiTab-root": {
                  color: "rgba(232,234,238,0.6)",
                  minHeight: 36,
                  textTransform: "none",
                  fontSize: 13,
                },
                "& .Mui-selected": { color: "#EEEEF0 !important" },
                "& .MuiTabs-indicator": { bgcolor: "#9A9EA8" },
              }}
            >
              {STUDIO_CHECK_IDS.map((id) => (
                <Tab key={id} value={id} label={t(`checksTab.${id}`)} />
              ))}
            </Tabs>
            {checksTab === "observer" && projectId ? (
              <ObserverPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "sentinel" && projectId ? (
              <SentinelPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "qa" ? (
              <QaPanel projectId={projectId || undefined} embedded />
            ) : null}
            {checksTab === "processAudit" ? (
              <ProcessAuditPanel projectId={projectId || undefined} embedded />
            ) : null}
            {checksTab === "health" ? (
              <HealthPanel projectId={projectId || undefined} embedded />
            ) : null}
            {checksTab === "readiness" ? (
              <ReadinessPanel projectId={projectId || undefined} embedded />
            ) : null}
            {checksTab === "truth" ? (
              <TruthPanel projectId={projectId || undefined} embedded />
            ) : null}
          </Stack>
      ) : null}
    </Stack>
    </Box>
  );
}
