"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  List,
  ListItem,
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
  IconButton,
  Tooltip,
} from "@mui/material";
import { ThemeProvider, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import SearchIcon from "@mui/icons-material/Search";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { createStudioRunAbort } from "@/lib/studio-run-abort";
import type { EngineeringLoopRun } from "@atlas/shared";
import { LinkWorkspaceRoot } from "@/components/workspace/LinkWorkspaceRoot";
import {
  StudioGithubSourceBar,
  type StudioGithubSource,
} from "@/components/studio/StudioGithubSourceBar";
import { AiCompanionBar } from "@/components/layout/AiCompanionBar";
import { createAtlasTheme } from "@/styles/theme";
import { ChatPanel } from "@/components/studio/ChatPanel";
import { CloudToolsPanel } from "@/components/studio/CloudToolsPanel";
import { ObserverPanel } from "@/components/studio/ObserverPanel";
import { SentinelPanel } from "@/components/studio/SentinelPanel";
import { QaPanel } from "@/components/studio/QaPanel";
import { ProcessAuditPanel } from "@/components/studio/ProcessAuditPanel";
import { HealthPanel } from "@/components/studio/HealthPanel";
import { ReadinessPanel } from "@/components/studio/ReadinessPanel";
import { TruthPanel } from "@/components/studio/TruthPanel";
import { GatesView } from "@/components/views/GatesView";
import { EvalView } from "@/components/views/EvalView";
import { ArchitectureContractView } from "@/components/views/ArchitectureContractView";
import { ConflictsView } from "@/components/views/ConflictsView";
import { LegalMediaView } from "@/components/views/LegalMediaView";
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
  STUDIO_FILE_ACTIONS,
  WEB_NAV_PATHS,
  buildStudioSearch,
  isStudioCheckId,
  studioFileActionInstruction,
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
  openStudioFileTabIndexForKey,
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
  /** Present when the tree is read from GitHub (no local folder linked). */
  source?: StudioGithubSource;
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
  onDelete,
  onRename,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, kind: "dir" | "file") => void;
  onDelete: (path: string, kind: "dir" | "file") => void;
  onRename: (oldPath: string, newName: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(depth < 2);
  const [hover, setHover] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(node.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name) {
      onRename(node.path, trimmed);
    }
    setRenaming(false);
  };

  if (node.kind === "file") {
    return (
      <ListItem
        disablePadding
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        secondaryAction={
          hover && !renaming ? (
            <Tooltip title="Delete file">
              <IconButton
                size="small"
                edge="end"
                aria-label="delete file"
                onClick={(e) => { e.stopPropagation(); onDelete(node.path, "file"); }}
                sx={{ color: "rgba(220,221,225,0.45)", "&:hover": { color: "#f44336" }, mr: 0.25 }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      >
        <ListItemButton
          dense
          selected={selectedPath === node.path}
          onClick={() => { if (!renaming) onSelect(node.path, "file"); }}
          onDoubleClick={startRename}
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
          {renaming ? (
            <TextField
              size="small"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              sx={{
                width: "100%",
                "& .MuiInputBase-input": { fontSize: 13, py: 0.25, color: "#DCDDE1" },
                "& .MuiOutlinedInput-root": {
                  bgcolor: "rgba(255,255,255,0.06)",
                  "& fieldset": { borderColor: "rgba(232,234,238,0.3)" },
                },
              }}
            />
          ) : (
            <ListItemText
              primary={node.name}
              primaryTypographyProps={{ fontSize: 13, noWrap: true }}
            />
          )}
        </ListItemButton>
      </ListItem>
    );
  }
  return (
    <ListItem
      disablePadding
      sx={{ display: "block" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      secondaryAction={
        hover && depth > 0 && !renaming ? (
          <Tooltip title="Delete folder">
            <IconButton
              size="small"
              edge="end"
              aria-label="delete folder"
              onClick={(e) => { e.stopPropagation(); onDelete(node.path, "dir"); }}
              sx={{ color: "rgba(220,221,225,0.45)", "&:hover": { color: "#f44336" }, mr: 0.25 }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        ) : undefined
      }
    >
      <ListItemButton
        dense
        aria-expanded={open}
        onClick={() => { if (!renaming) setOpen((v) => !v); }}
        onDoubleClick={depth > 0 ? startRename : undefined}
        sx={{ ps: 1.5 + depth * 1.25, borderRadius: 1.5, mx: 0.5, color: "#DCDDE1" }}
      >
        {renaming ? (
          <TextField
            size="small"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            sx={{
              width: "100%",
              "& .MuiInputBase-input": { fontSize: 13, py: 0.25, color: "#DCDDE1", fontWeight: 650 },
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgba(255,255,255,0.06)",
                "& fieldset": { borderColor: "rgba(232,234,238,0.3)" },
              },
            }}
          />
        ) : (
          <ListItemText
            primary={`${open ? "▾" : "▸"} ${node.name || "/"}`}
            primaryTypographyProps={{
              fontSize: 13,
              fontWeight: 650,
              noWrap: true,
            }}
          />
        )}
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
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </List>
      </Collapse>
    </ListItem>
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
  // Stage 5 (D4): correction flow — when set, the next propose will include
  // supersedesPatchId referencing the REJECTED patch being corrected.
  const [correctionForPatchId, setCorrectionForPatchId] = useState<string | null>(null);
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

  const openFilesId = useId();
  const editorPanelId = `${openFilesId}-panel`;
  const openFileTabId = (index: number) => `${openFilesId}-tab-${index}`;
  const selectedOpenIndex = selectedPath ? openFiles.indexOf(selectedPath) : -1;
  const focusableOpenIndex = selectedOpenIndex >= 0 ? selectedOpenIndex : 0;

  const onOpenFilesKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next = openStudioFileTabIndexForKey(
      event.key,
      selectedOpenIndex,
      openFiles.length,
      rtl,
    );
    if (next === null) return;
    const path = openFiles[next];
    if (path === undefined) return;
    event.preventDefault();
    event.currentTarget
      .querySelectorAll<HTMLElement>('[role="tab"]')
      .item(next)
      ?.focus();
    selectStudioFile(path);
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
  const panelBorder = "1px solid #262930";
  const panelBg = "#181A1F";

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

  const [moveTo, setMoveTo] = useState("");

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

  const moveFile = useMutation({
    mutationFn: () =>
      apiPost<{ from: string; to: string }>("/api/v1/studio/file/move", {
        projectId,
        from: selectedPath,
        to: moveTo.trim(),
      }),
    onSuccess: (moved) => {
      setBuffers((prev) => {
        const next = { ...prev };
        if (selectedPath) delete next[selectedPath];
        return next;
      });
      setMoveTo("");
      selectStudioFile(moved.to);
      void treeQuery.refetch();
    },
  });

  const [newFolderPath, setNewFolderPath] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const createFolder = useMutation({
    mutationFn: () =>
      apiPost<{ path: string }>("/api/v1/studio/folder", {
        projectId,
        path: newFolderPath.trim(),
      }),
    onSuccess: () => {
      setNewFolderPath("");
      setShowNewFolder(false);
      void treeQuery.refetch();
    },
  });

  const deleteFile = useMutation({
    mutationFn: (path: string) =>
      apiDelete<{ path: string }>("/api/v1/studio/file", {
        projectId,
        path,
      }),
    onSuccess: (deleted) => {
      closeStudioFile(deleted.path);
      void treeQuery.refetch();
    },
  });

  const deleteFolder = useMutation({
    mutationFn: (path: string) =>
      apiDelete<{ path: string }>("/api/v1/studio/folder", {
        projectId,
        path,
      }),
    onSuccess: () => {
      void treeQuery.refetch();
    },
  });

  const renameNode = useMutation({
    mutationFn: ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const parent = oldPath.includes("/")
        ? oldPath.slice(0, oldPath.lastIndexOf("/"))
        : "";
      const newPath = parent ? `${parent}/${newName}` : newName;
      return apiPost<{ from: string; to: string }>("/api/v1/studio/file/move", {
        projectId,
        from: oldPath,
        to: newPath,
      });
    },
    onSuccess: (moved) => {
      setBuffers((prev) => {
        const next = { ...prev };
        if (moved.from in next) {
          next[moved.to] = next[moved.from]!;
          delete next[moved.from];
        }
        return next;
      });
      if (selectedPath === moved.from) {
        selectStudioFile(moved.to);
      }
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

  const runAbort = useMemo(() => createStudioRunAbort(), []);

  const propose = useMutation({
    mutationFn: () =>
      apiPost<AskResult>(
        "/api/v1/studio/ask-agent",
        {
          projectId: projectId || null,
          path: selectedPath ?? undefined,
          mode: modeAsk,
          instruction,
          ...(selectedFindingId ? { findingId: selectedFindingId } : {}),
          // Stage 5 (D4): attach supersedesPatchId when correcting a rejected patch
          ...(correctionForPatchId ? { supersedesPatchId: correctionForPatchId } : {}),
        },
        { signal: runAbort.start() },
      ),
    onSuccess: (data) => {
      if (projectId && data.patch?.id) {
        void queryClient.invalidateQueries({ queryKey: ["patches", projectId] });
      }
      // Stage 5 (D4): clear correction context after the patch is created
      setCorrectionForPatchId(null);
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
      return apiPost<EngineeringLoopRun>(
        "/api/v1/engineering/loop",
        {
          workspaceRoot: selectedProject.workspaceRoot,
          userRequest: instruction,
          projectId,
          projectSlug: selectedProject.slug,
          mode: modeAsk,
        },
        { signal: runAbort.start() },
      );
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

  // Workspace layout (VS Code–style). The top bar holds the four rooms;
  // Agent chat lives in the side panel and the terminal in the bottom panel,
  // so the legacy `?tab=chat` / `?tab=pty` deep links still land there.
  const workspaceTab: "files" | "run" | "cloud" | "checks" =
    tab === "chat" || tab === "pty" ? "files" : tab;
  const [sidePanel, setSidePanel] = useState<
    "agent" | "chat" | "patches" | "psa" | "more"
  >(tab === "chat" ? "chat" : "agent");
  const [bottomPanel, setBottomPanel] = useState<"problems" | "terminal">(
    tab === "pty" ? "terminal" : "problems",
  );
  useEffect(() => {
    if (tab === "chat") setSidePanel("chat");
    if (tab === "pty") setBottomPanel("terminal");
  }, [tab]);
  // Remember the side panel across reloads (like VS Code), so a patch that is
  // mid-review stays on screen after a refresh. `?tab=chat` still wins.
  useEffect(() => {
    if (tab === "chat") return;
    try {
      const saved = window.localStorage.getItem("atlas.studio.sidePanel");
      if (
        saved === "agent" ||
        saved === "patches" ||
        saved === "psa" ||
        saved === "more"
      ) {
        setSidePanel(saved);
      }
    } catch {
      // Storage unavailable (private mode): keep the default panel.
    }
    // Read once on mount only.
  }, []);
  useEffect(() => {
    try {
      if (sidePanel !== "chat") {
        window.localStorage.setItem("atlas.studio.sidePanel", sidePanel);
      }
    } catch {
      // Storage unavailable: nothing to remember.
    }
  }, [sidePanel]);
  const proposedPatchId = propose.data?.patch?.id ?? null;
  useEffect(() => {
    if (proposedPatchId) setSidePanel("patches");
  }, [proposedPatchId]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activity, setActivity] = useState<"explorer" | "search" | "git">("explorer");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [editorToolsOpen, setEditorToolsOpen] = useState(false);

  const openSidePanel = (next: typeof sidePanel) => {
    setSidePanel(next);
    if (next === "chat") selectTab("chat");
    else if (tab === "chat") selectTab("files");
  };
  const openBottomPanel = (next: typeof bottomPanel) => {
    setBottomPanel(next);
    if (next === "terminal") selectTab("pty");
    else if (tab === "pty") selectTab("files");
  };
  const dirtyCount = Object.values(buffers).filter((b) => studioBufferIsDirty(b)).length;

  // VS Code–style shortcuts: Ctrl/Cmd+S save, Ctrl+` terminal, Ctrl+Shift+F search.
  const shortcutRef = useRef({ canSave: false, save: () => {}, terminal: () => {} });
  shortcutRef.current = {
    canSave:
      Boolean(selectedPath && currentBuffer && isDirty) &&
      !saveFile.isPending &&
      !fileQuery.data?.truncated &&
      !fileQuery.data?.readOnly,
    save: () => saveFile.mutate(),
    terminal: () => openBottomPanel("terminal"),
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        if (shortcutRef.current.canSave) shortcutRef.current.save();
      } else if (event.code === "Backquote") {
        event.preventDefault();
        shortcutRef.current.terminal();
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setActivity("search");
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Studio is a dark workspace regardless of the site theme, so every panel
  // inside it (Problems, Git, PSA, Checks) renders with dark inputs and text.
  const outerTheme = useTheme();
  const studioTheme = useMemo(
    () => createAtlasTheme(outerTheme.direction, "dark"),
    [outerTheme.direction],
  );
  const ink = "#D4D6DB";
  const inkStrong = "#EEF0F3";
  const muted = "#8B9099";
  const chromeBg = "#101216";
  const editorBg = "#1B1D22";
  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      color: ink,
      bgcolor: chromeBg,
      "& fieldset": { borderColor: "rgba(232,234,238,0.16)" },
    },
    "& .MuiInputLabel-root": { color: muted },
  } as const;
  const tabsSx = (height: number) =>
    ({
      minHeight: height,
      "& .MuiTab-root": {
        color: muted,
        minHeight: height,
        minWidth: 0,
        px: 1.5,
        textTransform: "none",
        fontSize: 13,
      },
      "& .Mui-selected": { color: `${inkStrong} !important` },
      "& .MuiTabs-indicator": { bgcolor: "#4C8DFF" },
    }) as const;
  const pickProjectState = (
    <Stack
      spacing={1.5}
      alignItems="center"
      justifyContent="center"
      sx={{ py: { xs: 6, md: 10 }, px: 2, textAlign: "center", color: muted }}
    >
      <Typography sx={{ color: inkStrong, fontWeight: 600, fontSize: 16 }}>
        {t("emptyTitle")}
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 380, color: muted }}>
        {shouldShowStudioEmptyProjects({
          isError: projectsQuery.isError,
          isLoading: projectsQuery.isLoading,
          projectId,
          projectCount: projects.length,
        })
          ? t("noProjects")
          : t("pickProject")}
      </Typography>
      <Button component={Link} href="/projects" variant="outlined" size="small">
        {t("goProjects")}
      </Button>
    </Stack>
  );

  return (
    <ThemeProvider theme={studioTheme}>
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: { lg: "calc(100vh - 56px)" },
        minHeight: { xs: "calc(100vh - 56px)" },
        overflow: "hidden",
        color: ink,
        textAlign: "start",
        bgcolor: "#15171C",
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1.25,
          px: { xs: 1.5, md: 2 },
          py: 1,
          bgcolor: chromeBg,
          borderBottom: panelBorder,
        }}
      >
        <Typography
          variant="h1"
          sx={{ fontSize: 15, fontWeight: 600, color: inkStrong, m: 0, textAlign: "start" }}
        >
          {t("title")}
        </Typography>
        <TextField
          select
          size="small"
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
          title={t("projectHelp")}
          sx={{ minWidth: 200, maxWidth: 320, ...fieldSx }}
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
            sx={{ color: muted, textTransform: "none" }}
          >
            {t("projectState")}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: muted, fontSize: 12.5 }}>
          <Typography component="span" sx={{ fontSize: 12.5, color: muted }}>
            {t("governanceShort")}
          </Typography>
          <Button
            size="small"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            sx={{ textTransform: "none", minWidth: 0, fontSize: 12.5 }}
          >
            {detailsOpen ? t("governanceHide") : t("governanceDetails")}
          </Button>
        </Stack>
      </Box>

      <Collapse in={detailsOpen} unmountOnExit>
        <Box sx={{ px: { xs: 1.5, md: 2 }, py: 1.5, bgcolor: chromeBg, borderBottom: panelBorder }}>
          <Typography variant="body2" sx={{ color: ink, maxWidth: 820 }}>
            {t("subtitle")}
          </Typography>
          <Typography variant="body2" sx={{ color: muted, mt: 0.75, maxWidth: 820 }}>
            {t("agentPolicy")}
          </Typography>
          <Typography variant="caption" sx={{ color: muted, display: "block", mt: 0.75 }}>
            {t("projectHelp")}
          </Typography>
          <Box sx={{ mt: 1.5, maxWidth: 820 }}>
            <AiCompanionBar />
          </Box>
          {projectId && hasRoot ? (
            <Box sx={{ mt: 1.5, maxWidth: 820 }}>
              <LinkWorkspaceRoot
                projectId={projectId}
                currentRoot={selectedProject?.workspaceRoot}
                compact
              />
            </Box>
          ) : null}
        </Box>
      </Collapse>

      {projectId && !hasRoot && !projectsQuery.isLoading ? (
        <Stack
          spacing={1.25}
          sx={{ px: { xs: 1.5, md: 2 }, py: 1.5, borderBottom: panelBorder }}
        >
          <StudioGithubSourceBar
            projectId={projectId}
            source={treeQuery.data?.source ?? null}
          />
          {treeQuery.data?.source ? null : (
            <LinkWorkspaceRoot
              projectId={projectId}
              currentRoot={selectedProject?.workspaceRoot}
              compact
            />
          )}
        </Stack>
      ) : null}

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          bgcolor: chromeBg,
          borderBottom: panelBorder,
          pe: { xs: 0.5, md: 1 },
        }}
      >
      <Tabs
        value={workspaceTab}
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
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          ...tabsSx(40),
          px: { xs: 0.5, md: 1 },
          flex: 1,
          minWidth: 0,
        }}
      >
        {(["files", "run", "cloud", "checks"] as const).map((id) => (
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
      <Button
        component={Link}
        href={WEB_NAV_PATHS.dashboard}
        size="small"
        sx={{ color: muted, textTransform: "none", fontSize: 13, whiteSpace: "nowrap" }}
      >
        {t("dashboard")}
      </Button>
      </Box>

      {projectsQuery.isError ? (
        <Alert severity="error" sx={{ m: 1.5 }}>
          {(projectsQuery.error as Error).message}
        </Alert>
      ) : null}

      {shouldShowStudioNeedRoot({
        isError: projectsQuery.isError,
        projectId,
        hasWorkspaceRoot: hasRoot,
      }) ? (
        <Alert severity="warning" sx={{ m: 1.5 }}>
          {t("needRoot")}{" "}
          <Link href="/projects">{t("goProjects")}</Link>
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {workspaceTab === "files" ? (
        <>
      {treeQuery.isError ? (
        <Alert severity="error" sx={{ m: 1.5 }}>{(treeQuery.error as Error).message}</Alert>
      ) : null}

      {(
        <Box
          sx={{
            // Fixed height on desktop so the editor scrolls inside its pane
            // (flex: 1 would let the grid grow to the file's full length).
            flex: 1,
            minHeight: { xs: 0, lg: 480 },
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              md: "290px minmax(0, 1fr)",
              lg: "280px minmax(0, 1fr) 320px",
              xl: "310px minmax(0, 1fr) 380px",
            },
            gridTemplateRows: {
              xs: "auto",
              md: "minmax(420px, 1fr) 240px auto",
              lg: "minmax(0, 1fr) 240px",
            },
            gridTemplateAreas: {
              xs: '"tree" "editor" "bottom" "side"',
              md: '"tree editor" "tree bottom" "side side"',
              lg: '"tree editor side" "tree bottom side"',
            },
          }}
        >
          <Box
            sx={{
              gridArea: "editor",
              minWidth: 0,
              minHeight: { xs: 360, md: 0 },
              display: "flex",
              flexDirection: "column",
              bgcolor: editorBg,
              overflow: "hidden",
            }}
          >
              {openFiles.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0}
                  role="tablist"
                  aria-label={t("openFiles")}
                  onKeyDown={onOpenFilesKeyDown}
                  sx={{
                    bgcolor: "#15171C",
                    borderBottom: panelBorder,
                    overflowX: "auto",
                    flexShrink: 0,
                  }}
                >
                  {openFiles.map((path, index) => (
                    <Chip
                      key={path}
                      role="tab"
                      id={openFileTabId(index)}
                      aria-selected={path === selectedPath}
                      aria-controls={editorPanelId}
                      tabIndex={index === focusableOpenIndex ? 0 : -1}
                      size="small"
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
                        height: 36,
                        borderRadius: 0,
                        color: path === selectedPath ? inkStrong : muted,
                        bgcolor: path === selectedPath ? editorBg : "transparent",
                        borderTop: path === selectedPath ? "2px solid #4C8DFF" : "2px solid transparent",
                        borderInlineEnd: panelBorder,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 12.5,
                        "& .MuiChip-deleteIcon": { color: muted },
                      }}
                    />
                  ))}
                </Stack>
              ) : null}
              <Box
                id={editorPanelId}
                role={openFiles.length > 0 ? "tabpanel" : undefined}
                aria-labelledby={
                  openFiles.length > 0 ? openFileTabId(focusableOpenIndex) : undefined
                }
                sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ px: 1.5, py: 0.75, borderBottom: panelBorder, flexShrink: 0 }}
                >
                  <Typography
                    variant="caption"
                    noWrap
                    dir="ltr"
                    aria-label={t("breadcrumbs")}
                    sx={{
                      flex: 1,
                      color: muted,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      textAlign: "left",
                    }}
                  >
                    {crumbs.length > 0 ? crumbs.join(" › ") : t("pickFile")}
                  </Typography>
                  {fileQuery.data?.languageHint ? (
                    <Typography variant="caption" sx={{ color: muted, px: 1 }}>
                      {fileQuery.data.languageHint}
                    </Typography>
                  ) : null}
                  {fileQuery.data?.truncated || isDirty ? (
                    <Chip
                      size="small"
                      label={fileQuery.data?.truncated ? t("fileTruncated") : t("dirty")}
                      sx={{ height: 22 }}
                    />
                  ) : null}
                  <Button
                    size="small"
                    onClick={() => setEditorToolsOpen((v) => !v)}
                    aria-expanded={editorToolsOpen}
                    disabled={!selectedPath}
                    sx={{ textTransform: "none", minWidth: 0 }}
                  >
                    {t("editorTools")}
                  </Button>
                  <Button
                    size="small"
                    disabled={!selectedPath || fileQuery.isFetching}
                    sx={{ textTransform: "none", minWidth: 0 }}
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
                    sx={{ textTransform: "none" }}
                  >
                    {saveFile.isPending ? t("asking") : t("saveFile")}
                  </Button>
                </Stack>
                <Collapse in={editorToolsOpen && Boolean(selectedPath)} unmountOnExit>
                  <Box sx={{ borderBottom: panelBorder }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                      sx={{ px: 1.5, py: 1 }}
                    >
                      <TextField
                        size="small"
                        label={t("moveTo")}
                        value={moveTo}
                        onChange={(event) => setMoveTo(event.target.value)}
                        sx={{ minWidth: 180, flex: 1, ...fieldSx }}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={
                          moveFile.isPending ||
                          !selectedPath ||
                          moveTo.trim().length === 0 ||
                          moveTo.trim() === selectedPath
                        }
                        onClick={() => {
                          if (isDirty && !window.confirm(t("unsavedConfirm"))) return;
                          moveFile.mutate();
                        }}
                      >
                        {t("moveFile")}
                      </Button>
                    </Stack>
                    {selectedPath && fileQuery.data && !fileQuery.data.readOnly ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ px: 1.5, pb: 1 }}
                      >
                        <TextField
                          size="small"
                          label={t("findInFile")}
                          value={findText}
                          onChange={(event) => {
                            setFindText(event.target.value);
                            setReplaceNote(null);
                          }}
                          sx={{ minWidth: 140, flex: 1, ...fieldSx }}
                        />
                        <TextField
                          size="small"
                          label={t("replaceInFile")}
                          value={replaceText}
                          onChange={(event) => {
                            setReplaceText(event.target.value);
                            setReplaceNote(null);
                          }}
                          sx={{ minWidth: 140, flex: 1, ...fieldSx }}
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
                      <Typography variant="caption" sx={{ px: 1.5, pb: 1, display: "block", color: muted }}>
                        {replaceNote}
                      </Typography>
                    ) : null}
                    {selectedPath && fileQuery.data && /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(selectedPath) ? (
                      <StudioLanguageBar
                        projectId={projectId}
                        path={selectedPath}
                        content={currentBuffer?.draft ?? fileQuery.data.content}
                        onOpen={(path, line) => selectStudioFile(path, line)}
                      />
                    ) : null}
                    {outline.length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        flexWrap="wrap"
                        useFlexGap
                        aria-label={t("outline")}
                        sx={{ px: 1.5, pb: 1 }}
                      >
                        {outline.slice(0, 16).map((symbol) => (
                          <Chip
                            key={`${symbol.kind}:${symbol.name}:${symbol.line}`}
                            size="small"
                            variant="outlined"
                            label={`${symbol.name}:${symbol.line}`}
                            onClick={() => setRevealLine(symbol.line)}
                            aria-label={`${symbol.kind} ${symbol.name}`}
                            sx={{ color: ink, borderColor: "rgba(232,234,238,0.2)" }}
                          />
                        ))}
                      </Stack>
                    ) : selectedPath && fileQuery.data ? (
                      <Typography variant="caption" sx={{ px: 1.5, pb: 1, display: "block", color: muted }}>
                        {t("outlineEmpty")}
                      </Typography>
                    ) : null}
                  </Box>
                </Collapse>
                {moveFile.isError ? (
                  <Alert severity="warning" sx={{ mx: 1.5, mt: 1 }}>
                    {(moveFile.error as Error).message}
                  </Alert>
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
                {saveFile.isSuccess && !isDirty ? (
                  <Typography variant="caption" role="status" sx={{ px: 1.5, pt: 0.75, color: "#6FBF73" }}>
                    {t("savedFile")}
                  </Typography>
                ) : null}
                {diskChangedPath && diskChangedPath === selectedPath ? (
                  <Alert severity="warning" sx={{ m: 1.5 }}>
                    {t("diskChanged")}
                  </Alert>
                ) : null}
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
                ) : !projectId ? (
                  pickProjectState
                ) : (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", minHeight: 240, p: 3 }}>
                    <Typography variant="body2" sx={{ color: muted, textAlign: "center" }}>
                      {selectedPath && fileQuery.isLoading
                        ? t("loadingFile")
                        : t("viewerHint")}
                    </Typography>
                  </Stack>
                )}
                </Box>
              </Box>
          </Box>

          <Box
            component="section"
            aria-label={t("bottomPanel")}
            sx={{
              gridArea: "bottom",
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              bgcolor: "#15171C",
              borderTop: panelBorder,
            }}
          >
            <Tabs
              value={bottomPanel}
              onChange={(_, v: typeof bottomPanel) => openBottomPanel(v)}
              aria-label={t("bottomPanel")}
              variant="scrollable"
              scrollButtons={false}
              sx={{ ...tabsSx(34), px: 0.5, flexShrink: 0 }}
            >
              <Tab value="problems" label={t("problems.title")} />
              <Tab value="terminal" label={t("tab.pty")} />
            </Tabs>
            <Box
              tabIndex={0}
              role="region"
              aria-label={t("bottomPanel")}
              sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1, pb: 1, outlineOffset: -2 }}
            >
              {!projectId ? (
                <Typography variant="body2" sx={{ color: muted, p: 1.5 }}>
                  {t("statusNoProject")}
                </Typography>
              ) : null}
              {projectId && bottomPanel === "problems" ? (
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
                    setSidePanel("agent");
                  }}
                />
              ) : null}
              {projectId && bottomPanel === "terminal" ? (
                <StudioPtyTerminal projectId={projectId} />
              ) : null}
            </Box>
          </Box>

          <Box
            component="section"
            aria-label={t("tree")}
            sx={{
              gridArea: "tree",
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              maxHeight: { xs: 360, md: "none" },
              bgcolor: panelBg,
              borderInlineEnd: { md: panelBorder },
              borderBottom: { xs: panelBorder, md: "none" },
            }}
          >
            <Stack
              role="toolbar"
              aria-orientation="vertical"
              aria-label={t("activityBar")}
              alignItems="center"
              spacing={0.5}
              sx={{ width: 48, flexShrink: 0, pt: 1, bgcolor: chromeBg, borderInlineEnd: panelBorder }}
            >
              {(
                [
                  ["explorer", <FolderOutlinedIcon key="i" />],
                  ["search", <SearchIcon key="i" />],
                  ["git", <AccountTreeIcon key="i" />],
                ] as const
              ).map(([id, icon]) => (
                <Tooltip key={id} title={t(`activity.${id}`)} placement="left">
                  <IconButton
                    aria-label={t(`activity.${id}`)}
                    aria-pressed={activity === id}
                    onClick={() => setActivity(id)}
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      color: activity === id ? inkStrong : muted,
                      borderInlineStart: activity === id ? "2px solid #4C8DFF" : "2px solid transparent",
                    }}
                  >
                    {icon}
                  </IconButton>
                </Tooltip>
              ))}
            </Stack>
            <Box
              tabIndex={0}
              role="region"
              aria-label={t(`activity.${activity}`)}
              sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", outlineOffset: -2 }}
            >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                px: 1.5,
                py: 1,
                position: "sticky",
                top: 0,
                bgcolor: panelBg,
                zIndex: 1,
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{ color: muted, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em" }}
              >
                {t(`activity.${activity}`)}
              </Typography>
              {activity === "explorer" && treeQuery.data?.truncated ? (
                <Chip size="small" label={t("truncated")} />
              ) : null}
              <Box sx={{ flexGrow: 1 }} />
              {hasRoot && activity === "explorer" ? (
                <Tooltip title={t("createFolder")}>
                  <IconButton
                    size="small"
                    aria-label={t("createFolder")}
                    onClick={() => setShowNewFolder((v) => !v)}
                    sx={{ color: muted, "&:hover": { color: ink } }}
                  >
                    <CreateNewFolderIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
            {!projectId ? (
              <Stack spacing={1.25} sx={{ px: 1.5, py: 1 }}>
                <Typography variant="body2" sx={{ color: muted }}>
                  {t("noFolderOpen")}
                </Typography>
                <Button
                  component={Link}
                  href="/projects"
                  variant="contained"
                  size="small"
                  sx={{ alignSelf: "flex-start", textTransform: "none" }}
                >
                  {t("goProjects")}
                </Button>
              </Stack>
            ) : null}
            {activity === "explorer" && showNewFolder ? (
              <Stack direction="row" spacing={0.75} sx={{ px: 1.5, pb: 0.5 }} alignItems="center">
                <TextField
                  size="small"
                  fullWidth
                  autoFocus
                  placeholder={t("newFolderPlaceholder")}
                  value={newFolderPath}
                  onChange={(e) => setNewFolderPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderPath.trim()) createFolder.mutate();
                    if (e.key === "Escape") { setShowNewFolder(false); setNewFolderPath(""); }
                  }}
                  sx={fieldSx}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={createFolder.isPending || !newFolderPath.trim()}
                  onClick={() => createFolder.mutate()}
                >
                  {t("createFolder")}
                </Button>
              </Stack>
            ) : null}
            {createFolder.isError ? (
              <Alert severity="error" sx={{ mx: 1.5, mb: 0.5 }}>
                {(createFolder.error as Error).message}
              </Alert>
            ) : null}
            {projectId && activity === "search" ? (
            <Box sx={{ px: 1.25, pb: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                inputProps={{ "aria-label": t("search") }}
                inputRef={searchInputRef}
                sx={fieldSx}
              />
            </Box>
            ) : null}
            {activity === "search" && trimmedSearch.length >= 2 ? (
              <Box sx={{ px: 0.5, pb: 1 }}>
                {searchQuery.isError ? (
                  <Alert severity="error" sx={{ mx: 1, mb: 1 }}>
                    {(searchQuery.error as Error).message}
                  </Alert>
                ) : null}
                {searchQuery.data?.truncated ? (
                  <Chip size="small" label={t("searchTruncated")} sx={{ mx: 1.5, mb: 0.5 }} />
                ) : null}
                <List dense disablePadding>
                  {(searchQuery.data?.items ?? []).map((hit) => (
                    <ListItem key={`${hit.path}:${hit.line}:${hit.preview}`} disablePadding>
                      <ListItemButton
                        onClick={() => selectStudioFile(hit.path, hit.line)}
                        sx={{ color: ink, borderRadius: 1 }}
                      >
                        <ListItemText
                          primary={hit.path}
                          secondary={`${hit.line}: ${hit.preview}`}
                          primaryTypographyProps={{ noWrap: true, fontSize: "0.8rem" }}
                          secondaryTypographyProps={{ noWrap: true, color: muted }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
                {searchQuery.isLoading ? (
                  <Typography variant="caption" sx={{ px: 1.5, color: muted }}>
                    {t("searchLoading")}
                  </Typography>
                ) : null}
                {searchQuery.isSuccess && (searchQuery.data?.items.length ?? 0) === 0 ? (
                  <Typography variant="caption" sx={{ px: 1.5, color: muted }}>
                    {t("searchEmpty")}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
            {activity === "explorer" && treeQuery.data ? (
              <List dense disablePadding sx={{ py: 0.5 }}>
                <TreeBranch
                  node={treeQuery.data.tree}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={(path, kind) => {
                    if (kind === "file") selectStudioFile(path);
                  }}
                  onDelete={(path, kind) => {
                    const label = kind === "file" ? "file" : "folder";
                    if (!window.confirm(`Delete ${label}: ${path}?`)) return;
                    if (kind === "file") {
                      deleteFile.mutate(path);
                    } else {
                      deleteFolder.mutate(path);
                    }
                  }}
                  onRename={(oldPath, newName) => {
                    renameNode.mutate({ oldPath, newName });
                  }}
                />
              </List>
            ) : projectId && activity === "explorer" ? (
              <Typography variant="body2" sx={{ p: 2, color: muted }}>
                {treeQuery.isLoading ? t("loadingTree") : t("emptyTree")}
              </Typography>
            ) : null}
            {projectId && activity === "git" ? (
              <Box sx={{ px: 1 }}>
                <StudioGitStatus
                  projectId={projectId}
                  onOpenFile={(path) => selectStudioFile(path)}
                />
              </Box>
            ) : null}
            </Box>
          </Box>

          <Box
            component="aside"
            aria-label={t("sidePanel")}
            sx={{
              gridArea: "side",
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              bgcolor: panelBg,
              borderInlineStart: { lg: panelBorder },
              borderTop: { xs: panelBorder, lg: "none" },
            }}
          >
            <Tabs
              value={sidePanel}
              onChange={(_, v: typeof sidePanel) => openSidePanel(v)}
              aria-label={t("sidePanel")}
              variant="scrollable"
              scrollButtons={false}
              sx={{ ...tabsSx(38), px: 0.5, borderBottom: panelBorder, flexShrink: 0 }}
            >
              <Tab value="agent" label={t("side.agent")} />
              <Tab value="chat" label={t("side.chat")} />
              <Tab
                value="patches"
                label={
                  propose.data?.patch ? `${t("side.patches")} •` : t("side.patches")
                }
              />
              <Tab value="psa" label={t("side.psa")} />
              <Tab value="more" label={t("side.more")} />
            </Tabs>
            <Box
              tabIndex={0}
              role="region"
              aria-label={t("sidePanel")}
              sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.75, outlineOffset: -2 }}
            >
            {!projectId && sidePanel !== "agent" && sidePanel !== "more" ? (
              <Typography variant="body2" sx={{ color: muted }}>
                {t("statusNoProject")}
              </Typography>
            ) : null}
            {projectId && sidePanel === "psa" ? <SupervisingAgentPanel projectId={projectId} /> : null}

            {sidePanel === "agent" ? (
            <Box>
              <Stack
                direction="row"
                spacing={0.75}
                flexWrap="wrap"
                useFlexGap
                aria-label={t("fileActions")}
              >
                {STUDIO_FILE_ACTIONS.map((action) => (
                  <Button
                    key={action}
                    size="small"
                    variant="outlined"
                    disabled={!selectedPath}
                    title={t("fileActionsHelp")}
                    onClick={() => {
                      if (!selectedPath) return;
                      setIntent("propose");
                      setInstruction(
                        studioFileActionInstruction(action, selectedPath),
                      );
                      propose.reset();
                      runLoop.reset();
                      saveNote.reset();
                    }}
                    sx={{ borderRadius: 4, textTransform: "none" }}
                  >
                    {t(`fileAction.${action}`)}
                  </Button>
                ))}
              </Stack>
              <Typography sx={{ mt: 1.75, fontWeight: 600, color: inkStrong, fontSize: 14 }}>
                {t("askTitle")}
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

              {correctionForPatchId ? (
                <Chip
                  size="small"
                  color="warning"
                  label={t("correctionMode", { patchId: correctionForPatchId.slice(0, 8) })}
                  onDelete={() => setCorrectionForPatchId(null)}
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
                sx={{
                  mt: 1.25,
                  flexWrap: "wrap",
                  gap: 0.5,
                  "& .MuiToggleButton-root": { color: muted, textTransform: "none", py: 0.25 },
                  "& .Mui-selected": { color: `${inkStrong} !important` },
                }}
                aria-label={t("intentLabel")}
              >
                <ToggleButton value="propose">{t("intentPropose")}</ToggleButton>
                <ToggleButton value="loop">{t("intentLoop")}</ToggleButton>
                <ToggleButton value="remind">{t("intentRemind")}</ToggleButton>
                <ToggleButton value="summary">{t("intentSummary")}</ToggleButton>
              </ToggleButtonGroup>

              <Typography variant="caption" display="block" sx={{ mt: 0.75, color: muted }}>
                {t(`intentHelp.${intent}`)}
              </Typography>

              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                {intent === "propose" || intent === "loop" ? (
                  <TextField
                    select
                    size="small"
                    label={t("mode")}
                    value={modeAsk}
                    onChange={(e) =>
                      setModeAsk(e.target.value as (typeof ASK_MODES)[number])
                    }
                    sx={fieldSx}
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
                  multiline
                  minRows={3}
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
                  sx={fieldSx}
                />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  {(intent === "propose" || intent === "loop") &&
                  (propose.isPending || runLoop.isPending) ? (
                    <Button
                      variant="outlined"
                      color="warning"
                      onClick={() => runAbort.cancel()}
                      sx={{ whiteSpace: "nowrap", textTransform: "none" }}
                    >
                      {t("cancelRun")}
                    </Button>
                  ) : null}
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      !projectId ||
                      instruction.trim().length < 3 ||
                      (intent === "loop" && !hasRoot)
                    }
                    onClick={submit}
                    sx={{ whiteSpace: "nowrap", textTransform: "none" }}
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
              </Stack>

              {(propose.isError || runLoop.isError || saveNote.isError) &&
                !((propose.error || runLoop.error) instanceof Error &&
                  (propose.error || runLoop.error)?.name === "AbortError") && (
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
                  {intent === "propose" && propose.data?.patch ? (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setSidePanel("patches")}
                      >
                        {t("side.patches")}
                      </Button>
                    </Box>
                  ) : null}
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
            ) : null}

            {projectId && sidePanel === "chat" ? (
              <ChatPanel projectId={projectId} selectedPath={selectedPath} embedded />
            ) : null}

            {projectId ? (
            <Box sx={{ display: sidePanel === "patches" ? "block" : "none" }}>
              <Stack spacing={1.5}>
                <StudioContinuity
                  projectId={projectId}
                  boundFindingId={selectedFindingId}
                />
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
                  onCorrect={(rejectedPatchId) => {
                    // Stage 5 (D4): store the rejected patch ID so the next
                    // propose call will include supersedesPatchId.
                    setCorrectionForPatchId(rejectedPatchId);
                    setIntent("propose");
                    setSidePanel("agent");
                  }}
                />
              </Stack>
            </Box>
            ) : null}

            {sidePanel === "more" ? (
            <Stack spacing={2}>
            <Box>
              <Typography fontWeight={600} sx={{ color: inkStrong }}>
                {t("cloneTitle")}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: muted }}>
                {t("cloneHelp")}
              </Typography>
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <TextField
                  select
                  size="small"
                  label={t("catalog")}
                  value={selectedExemplar?.id ?? ""}
                  onChange={(e) => {
                    setExemplarId(e.target.value);
                    setCloneUnitId("WHOLE");
                  }}
                  sx={fieldSx}
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
                  sx={fieldSx}
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
                  sx={{ alignSelf: "flex-start", textTransform: "none" }}
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
                <Typography variant="caption" sx={{ mt: 1, display: "block", color: muted }}>
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
            <Box sx={{ borderTop: panelBorder, pt: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography fontWeight={600} sx={{ color: inkStrong }}>
                  {t("aboutAgent")}
                </Typography>
                <Chip size="small" label={t("engineerRole")} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5, color: muted }}>
                {t("askHelp")}
              </Typography>
              <Typography variant="caption" sx={{ color: muted, display: "block", mt: 0.5 }}>
                {t("engineerNotPsa")}
              </Typography>
            </Box>
            </Stack>
            ) : null}
            </Box>
          </Box>
        </Box>
      )}
        </>
      ) : null}

      {workspaceTab === "run" ? (
        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          {projectId ? <StudioRunPanel projectId={projectId} /> : pickProjectState}
        </Box>
      ) : null}

      {workspaceTab === "cloud" ? (
        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          <CloudToolsPanel embedded />
        </Box>
      ) : null}

      {workspaceTab === "checks" ? (
          <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2 } }}>
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
              allowScrollButtonsMobile
              sx={{ ...tabsSx(40), borderBottom: panelBorder }}
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
            {checksTab === "observer" ? (
              <ObserverPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "sentinel" ? (
              <SentinelPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "qa" ? (
              <QaPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "processAudit" ? (
              <ProcessAuditPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "health" ? (
              <HealthPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "readiness" ? (
              <ReadinessPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "truth" ? (
              <TruthPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "gates" ? <GatesView /> : null}
            {checksTab === "eval" ? <EvalView /> : null}
            {checksTab === "contract" ? <ArchitectureContractView /> : null}
            {checksTab === "conflicts" ? <ConflictsView /> : null}
            {checksTab === "legal" ? <LegalMediaView /> : null}
          </Stack>
      ) : null}
      </Box>

      <Box
        component="footer"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 1.5,
          minHeight: 24,
          bgcolor: projectId ? "#1D3F7A" : "#23262D",
          color: projectId ? "#E4EBFA" : muted,
          fontSize: 11.5,
          flexWrap: "wrap",
        }}
      >
        <span>{selectedProject?.name ?? (projectId || t("statusNoProject"))}</span>
        {projectId && !hasRoot ? <span>{t("noRoot")}</span> : null}
        {dirtyCount > 0 ? <span>{t("unsavedCount", { count: dirtyCount })}</span> : null}
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          type="button"
          onClick={() => selectTab("run")}
          sx={{ all: "unset", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          {t("tab.run")}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => selectTab("checks")}
          sx={{ all: "unset", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          {t("tab.checks")}
        </Box>
        {selectedPath ? (
          <span dir="ltr">{fileQuery.data?.languageHint ?? studioFileBaseName(selectedPath)}</span>
        ) : null}
      </Box>
    </Box>
    </ThemeProvider>
  );
}
