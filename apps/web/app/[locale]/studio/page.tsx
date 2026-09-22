"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import CloseIcon from "@mui/icons-material/Close";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { StudioCodeEditor } from "@/components/studio/StudioCodeEditor";
import { StudioLanguageBar } from "@/components/studio/StudioLanguageBar";
import { StudioProblemsPanel } from "@/components/studio/StudioProblemsPanel";
import { StudioRunPanel } from "@/components/studio/StudioRunPanel";
import { StudioPtyTerminal } from "@/components/studio/StudioPtyTerminal";
import { StudioGitStatus } from "@/components/studio/StudioGitStatus";
import { StudioAgentBriefing } from "@/components/studio/StudioAgentBriefing";
import { StudioContinuity } from "@/components/studio/StudioContinuity";
import type { StudioProblem } from "@/lib/studio-problems";
import { studioProblemRemediationId } from "@/lib/studio-problems";
import {
  STUDIO_CHECK_IDS,
  STUDIO_TABS,
  buildStudioSearch,
  isStudioCheckId,
  isStudioTab,
  shouldShowStudioEmptyProjects,
  shouldShowStudioNeedRoot,
  type StudioCheckId,
  type StudioTab,
} from "@/lib/studio-surfaces";
import {
  addOpenStudioFile,
  anyStudioBufferDirty,
  closeOpenStudioFile,
  markStudioFileSaved,
  mergeStudioFileFromDisk,
  studioBufferIsDirty,
  studioFileBaseName,
  type StudioFileBuffer,
} from "@/lib/studio-workspace";
import { replaceInStudioBuffer } from "@/lib/studio-buffer-replace";
import { extractStudioOutline, studioFileBreadcrumbs } from "@/lib/studio-outline";

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
  patch: {
    id: string;
    title: string;
    status: string;
    filesChanged?: Array<{ path: string; action: string; summary?: string }>;
    evaluationSummary?: string | null;
    epistemicState?: string;
    confidence?: number;
    authorityHint?: string;
  } | null;
  note: string;
  memoryUsed?: number;
  memoryCitations?: Array<{
    id: string;
    type: string;
    epistemicState: string;
    category?: string;
    source?: string;
    statement: string;
  }>;
  intelligenceKind?: string;
  modelInvoked?: boolean;
  findingRemediation?: {
    result: string;
    verifyStatus: string;
    findingPresence: string;
    summary: string;
  } | null;
  guardianEvaluation?: {
    verdict: string;
    action: string;
    modelInvoked: boolean;
    knowledgeUsed: number;
    summary: string;
    conflicts: Array<{
      detectorId: string;
      proposedAction: string;
      detectedConflict: string;
      conflictingFact: string;
      source: string;
      path: string | null;
      epistemicState: string;
      affectedScope: string;
      verificationStatus: string;
      nextVerification: string;
    }>;
  } | null;
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
  const queryClient = useQueryClient();

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
    router.replace(
      `${pathname}${buildStudioSearch({
        tab: next,
        check: checksTab,
        projectId,
        file: selectedPath,
      })}`,
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
    router.replace(
      `${pathname}${buildStudioSearch({
        tab: "checks",
        check: next,
        projectId,
      })}`,
    );
  };

  const fileFromUrl = searchParams.get("file");
  const [projectId, setProjectId] = useState(projectFromUrl ?? "");
  const [selectedPath, setSelectedPath] = useState<string | null>(fileFromUrl);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replaceNote, setReplaceNote] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [intent, setIntent] = useState<StudioIntent>("propose");
  const [modeAsk, setModeAsk] = useState<(typeof ASK_MODES)[number]>("fix");
  const [buffers, setBuffers] = useState<Record<string, StudioFileBuffer>>({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [diskChangedPath, setDiskChangedPath] = useState<string | null>(null);
  const [cloneUnitId, setCloneUnitId] = useState("WHOLE");
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;

  useEffect(() => {
    if (projectFromUrl) setProjectId(projectFromUrl);
  }, [projectFromUrl]);

  useEffect(() => {
    setSelectedPath(fileFromUrl);
    if (fileFromUrl) {
      setOpenFiles((prev) => addOpenStudioFile(prev, fileFromUrl));
    }
  }, [fileFromUrl]);

  const selectStudioFile = (
    path: string,
    line: number | null = null,
  ) => {
    setSelectedPath(path);
    setRevealLine(line);
    setOpenFiles((prev) => addOpenStudioFile(prev, path));
    setTab("files");
    router.replace(
      `${pathname}${buildStudioSearch({
        tab: "files",
        projectId,
        file: path,
      })}`,
    );
  };

  const closeStudioFile = (path: string) => {
    if (
      studioBufferIsDirty(buffersRef.current[path]) &&
      !window.confirm(t("unsavedConfirm"))
    ) {
      return;
    }
    const closed = closeOpenStudioFile(openFiles, path);
    setOpenFiles(closed.open);
    setBuffers((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (diskChangedPath === path) setDiskChangedPath(null);
    if (selectedPath !== path) return;
    if (closed.nextActive) {
      selectStudioFile(closed.nextActive);
      return;
    }
    setSelectedPath(null);
    router.replace(
      `${pathname}${buildStudioSearch({
        tab: "files",
        projectId,
      })}`,
    );
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!anyStudioBufferDirty(buffersRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Studio-only dark surface — does not flip the rest of the app.
  const panelBorder = "1px solid rgba(232,234,238,0.12)";
  const panelBg = "rgba(28,31,38,0.92)";

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
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () =>
      apiGet<TreeResponse>(
        `/api/v1/studio/tree?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const fileQuery = useQuery({
    queryKey: ["studio-file", projectId, selectedPath],
    enabled: Boolean(projectId) && Boolean(selectedPath),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () =>
      apiGet<FileResponse>(
        `/api/v1/studio/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(selectedPath!)}`,
      ),
  });

  const trimmedSearch = fileSearch.trim();
  const searchQuery = useQuery({
    queryKey: ["studio-search", projectId, trimmedSearch],
    enabled: Boolean(projectId) && hasRoot && trimmedSearch.length >= 2,
    staleTime: 0,
    queryFn: () =>
      apiGet<{
        items: Array<{ path: string; line: number; preview: string }>;
        truncated: boolean;
      }>(
        `/api/v1/studio/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(trimmedSearch)}`,
      ),
  });

  useEffect(() => {
    if (!fileQuery.data) return;
    const path = fileQuery.data.path;
    const merged = mergeStudioFileFromDisk(
      buffersRef.current,
      path,
      fileQuery.data.content,
    );
    setBuffers(merged.buffers);
    setOpenFiles((prev) => addOpenStudioFile(prev, path));
    if (merged.diskChangedWhileDirty) {
      setDiskChangedPath(path);
    } else {
      setDiskChangedPath((current) => (current === path ? null : current));
    }
  }, [fileQuery.data]);

  const currentBuffer = selectedPath ? buffers[selectedPath] : undefined;
  const isDirty = studioBufferIsDirty(currentBuffer);
  const editorContent = currentBuffer?.draft ?? fileQuery.data?.content ?? "";
  const outline = useMemo(
    () => extractStudioOutline(editorContent),
    [editorContent],
  );
  const crumbs = selectedPath ? studioFileBreadcrumbs(selectedPath) : [];

  const applyBufferReplace = (mode: "one" | "all") => {
    if (!selectedPath) return;
    const result = replaceInStudioBuffer(
      editorContent,
      findText,
      replaceText,
      mode,
    );
    if (result.count === 0) {
      setReplaceNote(t("replaceNone"));
      return;
    }
    setBuffers((prev) => {
      const existing = prev[selectedPath] ?? {
        draft: editorContent,
        saved: fileQuery.data?.content ?? editorContent,
      };
      return {
        ...prev,
        [selectedPath]: { ...existing, draft: result.next },
      };
    });
    setReplaceNote(t("replaceCount", { count: result.count }));
  };

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
        content: currentBuffer?.draft ?? "",
      }),
    onSuccess: () => {
      if (selectedPath) {
        setBuffers((prev) => markStudioFileSaved(prev, selectedPath));
        setDiskChangedPath((current) =>
          current === selectedPath ? null : current,
        );
      }
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
        ...(selectedFindingId ? { findingId: selectedFindingId } : {}),
      }),
    onSuccess: (data) => {
      if (projectId && data.patch?.id) {
        void queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      }
    },
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
          if (
            anyStudioBufferDirty(buffersRef.current) &&
            !window.confirm(t("unsavedConfirm"))
          ) {
            return;
          }
          setProjectId(id);
          setSelectedPath(null);
          setSelectedFindingId(null);
          setOpenFiles([]);
          setBuffers({});
          setDiskChangedPath(null);
          propose.reset();
          saveNote.reset();
          router.replace(
            `${pathname}${buildStudioSearch({
              tab,
              check: checksTab,
              projectId: id,
            })}`,
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
        {projectId && !projects.some((p) => p.id === projectId) ? (
          <MenuItem value={projectId}>
            {projectsQuery.isPending ? t("loadingProjects") : projectId}
          </MenuItem>
        ) : null}
        {projects.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.workspaceRoot ? "" : ` (${t("noRoot")})`}
          </MenuItem>
        ))}
      </TextField>

      {projectId ? (
        <Button
          component={Link}
          href={`/projects/${projectId}/state`}
          size="small"
          sx={{ alignSelf: { sm: "center" }, color: "#9A9EA8" }}
        >
          {t("projectState")}
        </Button>
      ) : null}

      {projectId ? (
        <LinkWorkspaceRoot
          projectId={projectId}
          currentRoot={selectedProject?.workspaceRoot}
          compact
        />
      ) : null}

      {shouldShowStudioNeedRoot({
        isError: projectsQuery.isError,
        projectId,
        hasWorkspaceRoot: hasRoot,
      }) ? (
        <Alert severity="warning">
          {t("needRoot")}{" "}
          <Link href="/projects">{t("goProjects")}</Link>
        </Alert>
      ) : null}

      {projectId ? (
        <StudioContinuity
          projectId={projectId}
          boundFindingId={selectedFindingId}
        />
      ) : null}

      {projectsQuery.isError ? (
        <Alert severity="error">
          {(projectsQuery.error as Error).message}
        </Alert>
      ) : null}

      {shouldShowStudioEmptyProjects({
        isError: projectsQuery.isError,
        isLoading: projectsQuery.isLoading,
        projectId,
        projectCount: projects.length,
      }) ? (
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
        selectionFollowsFocus
        aria-label={t("title")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          requestAnimationFrame(() => {
            const id = document.activeElement?.getAttribute("data-studio-tab");
            if (id && isStudioTab(id) && id !== tab) selectTab(id);
          });
        }}
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
          <Tab
            key={id}
            value={id}
            label={t(`tab.${id}`)}
            data-studio-tab={id}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectTab(id);
              }
            }}
          />
        ))}
      </Tabs>

      {tab === "files" ? (
        <>
      {treeQuery.isError ? (
        <Alert severity="error">{(treeQuery.error as Error).message}</Alert>
      ) : null}

      {projectId ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "300px 1fr" },
            alignItems: "stretch",
            minHeight: { md: 560 },
          }}
        >
          <Stack spacing={2} sx={{ minWidth: 0 }}>
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
            <TextField
              size="small"
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              inputProps={{ "aria-label": t("search") }}
              sx={{
                mx: 1.5,
                mt: 1,
                mb: 0.5,
                "& .MuiOutlinedInput-root": {
                  color: "#DCDDE1",
                  bgcolor: "rgba(255,255,255,0.04)",
                  "& fieldset": { borderColor: "rgba(232,234,238,0.2)" },
                },
              }}
            />
            {trimmedSearch.length >= 2 ? (
              <List dense disablePadding sx={{ px: 0.5, pb: 1 }}>
                {searchQuery.isError ? (
                  <Alert severity="error" sx={{ mx: 1, mb: 1 }}>
                    {(searchQuery.error as Error).message}
                  </Alert>
                ) : null}
                {searchQuery.data?.truncated ? (
                  <Chip size="small" label={t("searchTruncated")} sx={{ mx: 1.5, mb: 0.5 }} />
                ) : null}
                {(searchQuery.data?.items ?? []).map((hit) => (
                  <ListItemButton
                    key={`${hit.path}:${hit.line}:${hit.preview}`}
                    onClick={() => selectStudioFile(hit.path, hit.line)}
                    sx={{ color: "#DCDDE1", borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={hit.path}
                      secondary={`${hit.line}: ${hit.preview}`}
                      primaryTypographyProps={{ noWrap: true, fontSize: "0.8rem" }}
                      secondaryTypographyProps={{ noWrap: true, color: "#8B9099" }}
                    />
                  </ListItemButton>
                ))}
                {searchQuery.isLoading ? (
                  <Typography variant="caption" sx={{ px: 1.5, color: "#8B9099" }}>
                    {t("searchLoading")}
                  </Typography>
                ) : null}
                {searchQuery.isSuccess && (searchQuery.data?.items.length ?? 0) === 0 ? (
                  <Typography variant="caption" sx={{ px: 1.5, color: "#8B9099" }}>
                    {t("searchEmpty")}
                  </Typography>
                ) : null}
              </List>
            ) : null}
            {treeQuery.data ? (
              <List dense disablePadding sx={{ py: 0.75 }}>
                <TreeBranch
                  node={treeQuery.data.tree}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={(path, kind) => {
                    if (kind === "file") selectStudioFile(path);
                  }}
                />
              </List>
            ) : (
              <Typography variant="body2" sx={{ p: 2, color: "#8B9099" }}>
                {treeQuery.isLoading ? t("loadingTree") : t("emptyTree")}
              </Typography>
            )}
          </Box>
          <StudioGitStatus
            projectId={projectId}
            onOpenFile={(path) => selectStudioFile(path)}
          />
          </Stack>

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
              {openFiles.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  flexWrap="wrap"
                  useFlexGap
                  role="tablist"
                  aria-label={t("openFiles")}
                  sx={{ px: 1.5, pt: 1, borderBottom: panelBorder }}
                >
                  {openFiles.map((path) => (
                    <Chip
                      key={path}
                      size="small"
                      color={path === selectedPath ? "primary" : "default"}
                      variant={path === selectedPath ? "filled" : "outlined"}
                      label={`${studioFileBaseName(path)}${
                        studioBufferIsDirty(buffers[path]) ? " •" : ""
                      }`}
                      onClick={() => selectStudioFile(path)}
                      onDelete={() => closeStudioFile(path)}
                      aria-label={path}
                      deleteIcon={
                        <CloseIcon fontSize="small" aria-label={t("closeFile")} />
                      }
                      sx={{
                        maxWidth: 220,
                        color: "#DCDDE1",
                        borderColor: "rgba(232,234,238,0.25)",
                      }}
                    />
                  ))}
                </Stack>
              ) : null}
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
                {fileQuery.data?.languageHint ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={fileQuery.data.languageHint}
                    sx={{ color: "#8B9099", borderColor: "rgba(232,234,238,0.25)" }}
                  />
                ) : null}
                <Chip
                  size="small"
                  label={
                    fileQuery.data?.truncated
                      ? t("fileTruncated")
                      : isDirty
                        ? t("dirty")
                        : t("editable")
                  }
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!selectedPath || fileQuery.isFetching}
                  onClick={() => {
                    if (
                      isDirty &&
                      !window.confirm(t("unsavedConfirm"))
                    ) {
                      return;
                    }
                    if (!selectedPath) return;
                    setBuffers((prev) => {
                      const next = { ...prev };
                      delete next[selectedPath];
                      return next;
                    });
                    setDiskChangedPath((current) =>
                      current === selectedPath ? null : current,
                    );
                    void fileQuery.refetch();
                  }}
                >
                  {t("reloadFile")}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    saveFile.isPending ||
                    !selectedPath ||
                    !currentBuffer ||
                    Boolean(fileQuery.data?.truncated) ||
                    Boolean(fileQuery.data?.readOnly) ||
                    !isDirty
                  }
                  onClick={() => saveFile.mutate()}
                >
                  {saveFile.isPending ? t("asking") : t("saveFile")}
                </Button>
              </Stack>
              {selectedPath && fileQuery.data && !fileQuery.data.readOnly ? (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ px: 1.5, py: 1, borderBottom: panelBorder }}
                >
                  <TextField
                    size="small"
                    label={t("findInFile")}
                    value={findText}
                    onChange={(event) => {
                      setFindText(event.target.value);
                      setReplaceNote(null);
                    }}
                    sx={{ minWidth: 140, flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label={t("replaceInFile")}
                    value={replaceText}
                    onChange={(event) => {
                      setReplaceText(event.target.value);
                      setReplaceNote(null);
                    }}
                    sx={{ minWidth: 140, flex: 1 }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!findText || Boolean(fileQuery.data.truncated)}
                    onClick={() => applyBufferReplace("one")}
                    aria-label={t("replaceOne")}
                  >
                    {t("replaceOne")}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!findText || Boolean(fileQuery.data.truncated)}
                    onClick={() => applyBufferReplace("all")}
                    aria-label={t("replaceAll")}
                  >
                    {t("replaceAll")}
                  </Button>
                </Stack>
              ) : null}
              {replaceNote ? (
                <Typography variant="caption" sx={{ px: 1.5, py: 0.5, color: "#8B9099" }}>
                  {replaceNote}
                </Typography>
              ) : null}
              {crumbs.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  aria-label={t("breadcrumbs")}
                  sx={{ px: 1.5, py: 0.75, borderBottom: panelBorder }}
                >
                  {crumbs.map((crumb, index) => (
                    <Chip
                      key={`${crumb}-${index}`}
                      size="small"
                      variant="outlined"
                      label={crumb}
                      sx={{ color: "#8B9099", borderColor: "rgba(232,234,238,0.2)" }}
                    />
                  ))}
                </Stack>
              ) : null}
              {outline.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  flexWrap="wrap"
                  useFlexGap
                  aria-label={t("outline")}
                  sx={{ px: 1.5, py: 0.75, borderBottom: panelBorder }}
                >
                  {outline.slice(0, 16).map((symbol) => (
                    <Chip
                      key={`${symbol.kind}:${symbol.name}:${symbol.line}`}
                      size="small"
                      label={`${symbol.name}:${symbol.line}`}
                      onClick={() => setRevealLine(symbol.line)}
                      aria-label={`${symbol.kind} ${symbol.name}`}
                      sx={{ color: "#DCDDE1", borderColor: "rgba(232,234,238,0.25)" }}
                    />
                  ))}
                </Stack>
              ) : selectedPath && fileQuery.data ? (
                <Typography variant="caption" sx={{ px: 1.5, py: 0.5, color: "#8B9099" }}>
                  {t("outlineEmpty")}
                </Typography>
              ) : null}
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
              {selectedPath && fileQuery.data && /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(selectedPath) ? (
                <StudioLanguageBar
                  projectId={projectId}
                  path={selectedPath}
                  content={currentBuffer?.draft ?? fileQuery.data.content}
                  onOpen={(path, line) => selectStudioFile(path, line)}
                />
              ) : null}
              {diskChangedPath && diskChangedPath === selectedPath ? (
                <Alert severity="warning" sx={{ m: 1.5 }}>
                  {t("diskChanged")}
                </Alert>
              ) : null}
              {fileQuery.data ? (
                <StudioCodeEditor
                  value={currentBuffer?.draft ?? fileQuery.data.content}
                  onChange={(value) => {
                    if (!selectedPath) return;
                    setBuffers((prev) => {
                      const existing = prev[selectedPath] ?? {
                        draft: fileQuery.data.content,
                        saved: fileQuery.data.content,
                      };
                      return {
                        ...prev,
                        [selectedPath]: { ...existing, draft: value },
                      };
                    });
                  }}
                  languageHint={fileQuery.data.languageHint}
                  readOnly={
                    Boolean(fileQuery.data.truncated) ||
                    fileQuery.data.readOnly
                  }
                  ariaLabel={selectedPath ?? t("pickFile")}
                  revealLine={revealLine}
                />
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                  {selectedPath && fileQuery.isLoading
                    ? t("loadingFile")
                    : t("viewerHint")}
                </Typography>
              )}
            </Box>

            <StudioProblemsPanel
              projectId={projectId}
              enabled={Boolean(projectId)}
              filePath={selectedPath}
              fileContent={currentBuffer?.draft ?? fileQuery.data?.content ?? null}
              onOpenFile={(path, line) => {
                selectStudioFile(path, line);
              }}
              onProposeFix={(problem: StudioProblem) => {
                const findingId = studioProblemRemediationId(problem);
                if (findingId) setSelectedFindingId(findingId);
                if (problem.file) selectStudioFile(problem.file, problem.line);
                if (problem.source === "sentinel") setModeAsk("secure");
                setIntent("propose");
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
              {selectedFindingId ? (
                <Chip
                  size="small"
                  color="warning"
                  label={`${t("boundFinding")}: ${selectedFindingId}`}
                  onDelete={() => setSelectedFindingId(null)}
                  sx={{ mt: 1 }}
                />
              ) : null}

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
                    propose.data?.findingRemediation?.result === "UNSUPPORTED" ||
                    propose.data?.findingRemediation?.result === "NOT_FIXED"
                      ? "warning"
                      : (intent === "propose" && !propose.data?.patch) ||
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
              {propose.data && intent === "propose" ? (
                <StudioAgentBriefing
                  result={propose.data}
                  onOpenFile={(path) => selectStudioFile(path)}
                />
              ) : null}
            </Box>

            <SupervisingAgentPanel projectId={projectId} />

            <StudioPatchWorkflow
              projectId={projectId}
              workspaceRoot={selectedProject?.workspaceRoot}
              focusPatchId={propose.data?.patch?.id ?? runLoop.data?.patchId ?? null}
              onVerified={() => {
                void queryClient.invalidateQueries({ queryKey: ["studio-file"] });
                void queryClient.invalidateQueries({ queryKey: ["studio-tree"] });
                void queryClient.invalidateQueries({ queryKey: ["studio-search"] });
                void queryClient.invalidateQueries({
                  queryKey: ["studio-problems-sentinel"],
                });
                void queryClient.invalidateQueries({
                  queryKey: ["studio-problems-gates"],
                });
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

      {tab === "run" ? (
        projectId ? (
          <StudioRunPanel projectId={projectId} />
        ) : (
          <Alert severity="info">{t("pickProject")}</Alert>
        )
      ) : null}

      {tab === "pty" ? (
        projectId ? (
          <StudioPtyTerminal projectId={projectId} />
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
              selectionFollowsFocus
              aria-label={t("tab.checks")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                requestAnimationFrame(() => {
                  const id = document.activeElement?.getAttribute("data-studio-check");
                  if (id && isStudioCheckId(id) && id !== checksTab) selectChecksTab(id);
                });
              }}
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
                <Tab
                  key={id}
                  value={id}
                  label={t(`checksTab.${id}`)}
                  data-studio-check={id}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectChecksTab(id);
                    }
                  }}
                />
              ))}
            </Tabs>
            {checksTab === "observer" && projectId ? (
              <ObserverPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "sentinel" && projectId ? (
              <SentinelPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "qa" && projectId ? (
              <QaPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "processAudit" && projectId ? (
              <ProcessAuditPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "health" && projectId ? (
              <HealthPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "readiness" && projectId ? (
              <ReadinessPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "truth" && projectId ? (
              <TruthPanel projectId={projectId} embedded />
            ) : null}
          </Stack>
      ) : null}
    </Stack>
    </Box>
  );
}
