"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  Menu,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import { ThemeProvider, useTheme, type Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import SearchIcon from "@mui/icons-material/Search";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import CodeIcon from "@mui/icons-material/Code";
import TerminalIcon from "@mui/icons-material/Terminal";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import { StudioMenuBar, type StudioMenuDef } from "@/components/studio/StudioMenuBar";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { useShellChrome } from "@/components/layout/shell-chrome";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { apiDelete, apiGet, apiPost, apiPut, resolveApiUrl } from "@/lib/api";
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
import { ConstitutionPanel } from "@/components/studio/ConstitutionPanel";
import { BenchmarksPanel } from "@/components/studio/BenchmarksPanel";
import { EngineeringRunsPanel } from "@/components/studio/EngineeringRunsPanel";
import { DeployFeedsPanel } from "@/components/studio/DeployFeedsPanel";
import { ReplaceAllDialog } from "@/components/studio/ReplaceAllDialog";
import { StudioPatchWorkflow } from "@/components/studio/StudioPatchWorkflow";
import { SupervisingAgentPanel } from "@/components/studio/SupervisingAgentPanel";
import { StudioCodeEditor } from "@/components/studio/StudioCodeEditor";
import { StudioLanguageBar } from "@/components/studio/StudioLanguageBar";
import { StudioProblemsPanel } from "@/components/studio/StudioProblemsPanel";
import { StudioRunPanel } from "@/components/studio/StudioRunPanel";
import { StudioPtyTerminal } from "@/components/studio/StudioPtyTerminal";
import { StudioGitStatus } from "@/components/studio/StudioGitStatus";
import { StudioDebugPanel } from "@/components/studio/StudioDebugPanel";
import { ExtensionsView } from "@/components/studio/extensions/ExtensionsView";
import { ExtensionDetail } from "@/components/studio/extensions/ExtensionDetail";
import { ExtensionPanelHost } from "@/components/studio/extensions/ExtensionPanelHost";
import { ExtensionIcon } from "@/components/studio/extensions/ExtensionIcon";
import {
  activityExtensions,
  extensionMessageKey,
  useStudioExtensionAction,
  useStudioExtensions,
} from "@/lib/studio-extensions";
import type { StudioExtensionScope } from "@/lib/studio-extension-api";
import { StudioAgentBriefing } from "@/components/studio/StudioAgentBriefing";
import { StudioContinuity } from "@/components/studio/StudioContinuity";
import type { StudioProblem } from "@/lib/studio-problems";
import { studioProblemRemediationId } from "@/lib/studio-problems";
import { useStudioProblems } from "@/lib/use-studio-problems";
import type { StudioDiffHunk } from "@/lib/studio-diff";
import {
  STUDIO_CHECK_IDS,
  STUDIO_FILE_ACTIONS,
  WEB_NAV_PATHS,
  buildStudioSearch,
  isStudioCheckId,
  studioFileActionInstruction,
  isStudioTab,
  shouldShowStudioEmptyProjects,
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
  /** SHA-256 of the file on disk when it was read (D3 overwrite guard). */
  contentHash?: string;
  note: string;
}

/** SHA-256 hex of UTF-8 text — matches the API's hashFileContent. */
async function sha256Hex(text: string): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

/** Every file path in a Studio tree, for "Go to file" (Ctrl+P). */
function flattenStudioTree(node: TreeNode, out: string[] = []): string[] {
  if (node.kind === "file") {
    out.push(node.path);
    return out;
  }
  for (const child of node.children ?? []) flattenStudioTree(child, out);
  return out;
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
            minHeight: { xs: 40, md: 26 },
            py: 0,
            "& .MuiListItemText-root": { my: 0 },
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
        sx={{ ps: 1.5 + depth * 1.25, minHeight: { xs: 40, md: 26 }, py: 0, "& .MuiListItemText-root": { my: 0 }, borderRadius: 1.5, mx: 0.5, color: "#DCDDE1" }}
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
  const tRoot = useTranslations();
  const tNav = useTranslations("nav");
  const tHub = useTranslations("hub");
  const tExt = useTranslations("studioExtensions");
  const locale = useLocale();
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

  // Back / Forward (Alt+Left / Alt+Right), like VS Code's editor navigation
  // history. A history entry is the file + the line it was opened at.
  const [nav, setNav] = useState<{
    stack: Array<{ path: string; line: number | null }>;
    index: number;
  }>({ stack: [], index: -1 });
  const pushNavEntry = (path: string, line: number | null) => {
    setNav((prev) => {
      const truncated = prev.stack.slice(0, prev.index + 1);
      const last = truncated[truncated.length - 1];
      if (last && last.path === path) {
        const updated = [...truncated];
        updated[updated.length - 1] = { path, line };
        return { stack: updated, index: updated.length - 1 };
      }
      const next = [...truncated, { path, line }];
      return { stack: next, index: next.length - 1 };
    });
  };

  const selectStudioFile = (
    path: string,
    line: number | null = null,
    fromHistory = false,
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
    if (!fromHistory) pushNavEntry(path, line);
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

  // Like VS Code reopening the last folder: remember the project, and open it
  // again when Studio is entered without one in the URL.
  const restoredProjectRef = useRef(false);
  useEffect(() => {
    if (restoredProjectRef.current || projectFromUrl || projectId) return;
    if (!projectsQuery.isSuccess) return;
    restoredProjectRef.current = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem("atlas.studio.lastProject");
    } catch {
      saved = null;
    }
    if (!saved || !projects.some((p) => p.id === saved)) return;
    setProjectId(saved);
    router.replace(`${pathname}${buildStudioSearch({ tab, check: checksTab, projectId: saved })}`);
  }, [projectsQuery.isSuccess, projects, projectFromUrl, projectId, router, pathname, tab, checksTab]);
  useEffect(() => {
    if (!projectId) return;
    try {
      window.localStorage.setItem("atlas.studio.lastProject", projectId);
    } catch {
      // Storage unavailable: Studio just won't reopen the project next time.
    }
  }, [projectId]);
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
    mutationFn: async () =>
      apiPut("/api/v1/studio/file", {
        projectId,
        path: selectedPath,
        content: currentBuffer?.draft ?? "",
        // D3: the API refuses to overwrite an existing file without the hash
        // of the content we opened, so a change on disk is never lost.
        expectedHash:
          fileQuery.data?.contentHash ??
          (currentBuffer ? await sha256Hex(currentBuffer.saved) : undefined),
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
    mutationFn: (to: string) =>
      apiPost<{ from: string; to: string }>("/api/v1/studio/file/move", {
        projectId,
        from: selectedPath,
        to: to.trim(),
      }),
    onSuccess: (moved) => {
      setBuffers((prev) => {
        const next = { ...prev };
        if (selectedPath) delete next[selectedPath];
        return next;
      });
      setOpenFiles((prev) => prev.filter((path) => path !== moved.from));
      setDialog(null);
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
  const [sidePanel, setSidePanel] = useState<"agent" | "chat" | "patches" | "psa">(
    tab === "chat" ? "chat" : "agent",
  );
  const [bottomPanel, setBottomPanel] = useState<"problems" | "terminal">(
    tab === "pty" ? "terminal" : "problems",
  );
  /** Two independent PTY sessions side by side (each its own xterm/ConPTY, ADR-021 governed). */
  const [splitTerminal, setSplitTerminal] = useState(false);
  /** Bumped to make the primary terminal pane open a brand-new session (New Terminal). */
  const [terminalNewSignal, setTerminalNewSignal] = useState(0);
  useEffect(() => {
    if (tab === "chat") {
      setSidePanel("chat");
      setShowSideChoice(true);
    }
    if (tab === "pty") {
      setBottomPanel("terminal");
      setShowBottom(true);
    }
  }, [tab]);
  // Remember the side panel across reloads (like VS Code), so a patch that is
  // mid-review stays on screen after a refresh. `?tab=chat` still wins.
  useEffect(() => {
    if (tab === "chat") return;
    try {
      const saved = window.localStorage.getItem("atlas.studio.sidePanel");
      // "more" was a tab before the menus took its tools; it opens as Agent.
      if (saved === "agent" || saved === "patches" || saved === "psa") {
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
    if (!proposedPatchId) return;
    setSidePanel("patches");
    setShowSideChoice(true);
    setMobileView("agent");
  }, [proposedPatchId]);
  /** Side-bar view: Explorer, Search, Extensions, or an extension panel (`ext:<id>`, ADR-026). */
  const [activity, setActivity] = useState<string>("explorer");
  const [extensionDetailId, setExtensionDetailId] = useState<string | null>(null);
  const [extensionMenu, setExtensionMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const extensionsQuery = useStudioExtensions(projectId || null);
  const extensionAction = useStudioExtensionAction(projectId || null);
  const barExtensions = activityExtensions(extensionsQuery.data);
  const activeExtension = activity.startsWith("ext:")
    ? (barExtensions.find((e) => `ext:${e.manifest.id}` === activity) ?? null)
    : null;
  const extName = (id: string) => tExt(`ext.${extensionMessageKey(id)}.name`);
  // A disabled/uninstalled extension (or another project) leaves no stale panel open.
  useEffect(() => {
    if (!activity.startsWith("ext:") || !extensionsQuery.isSuccess) return;
    if (!barExtensions.some((e) => `ext:${e.manifest.id}` === activity)) setActivity("explorer");
  }, [activity, barExtensions, extensionsQuery.isSuccess]);
  const activityTitle = activeExtension
    ? extName(activeExtension.manifest.id)
    : activity === "extensions"
      ? tExt("title")
      : t(`activity.${activity === "search" ? "search" : "explorer"}`);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ---- VS Code–style layout: panels open on demand, never stacked -------
  const isMd = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"), { noSsr: true });
  const isLg = useMediaQuery((theme: Theme) => theme.breakpoints.up("lg"), { noSsr: true });
  /** Explorer pane next to the activity bar (Ctrl+B). */
  const [showTree, setShowTree] = useState(true);
  /** Problems / terminal (Ctrl+J). Closed until asked for, like VS Code. */
  const [showBottom, setShowBottom] = useState(tab === "pty");
  /** Agent panel (Ctrl+Alt+B). null = automatic: open on wide screens only. */
  const [showSideChoice, setShowSideChoice] = useState<boolean | null>(
    tab === "chat" ? true : null,
  );
  const showSide = showSideChoice ?? isLg;
  /** Phones: one view at a time, switched from the bottom bar. */
  const [mobileView, setMobileView] = useState<"files" | "editor" | "agent" | "panel">(
    tab === "chat" ? "agent" : tab === "pty" ? "panel" : "editor",
  );
  const [codeToolsOpen, setCodeToolsOpen] = useState(false);
  /** Editor cursor position (1-based), so Code tools (hover/definition/references/rename) act where the cursor actually is. */
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [findOpen, setFindOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | "quickOpen"
    | "goToLine"
    | "goToSymbol"
    | "newFile"
    | "rename"
    | "linkFolder"
    | "clone"
    | "about"
    | "shortcuts"
  >(null);
  const [dialogText, setDialogText] = useState("");
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [replaceAllOpen, setReplaceAllOpen] = useState(false);
  const shell = useShellChrome();

  const openSidePanel = (next: typeof sidePanel) => {
    setSidePanel(next);
    setShowSideChoice(true);
    setMobileView("agent");
    if (next === "chat") selectTab("chat");
    else if (tab === "chat") selectTab("files");
  };
  const openBottomPanel = (next: typeof bottomPanel) => {
    setBottomPanel(next);
    setShowBottom(true);
    setMobileView("panel");
    if (next === "terminal") selectTab("pty");
    else if (tab === "pty") selectTab("files");
  };
  const closeBottomPanel = () => {
    setShowBottom(false);
    if (tab === "pty") selectTab("files");
    setMobileView("editor");
  };
  // Next/Previous Problem (F8 / Shift+F8): the same merged list
  // StudioProblemsPanel renders (shared react-query cache, see the hook).
  const problemsList = useStudioProblems(
    projectId,
    Boolean(projectId),
    selectedPath,
    currentBuffer?.draft ?? fileQuery.data?.content ?? null,
  );
  // -1 = no navigation yet, so the first Next lands on the first problem
  // (index 0) instead of skipping it, and the first Previous lands on the
  // last problem instead of re-visiting index 0.
  const [problemCursor, setProblemCursor] = useState(-1);
  const goToProblem = (index: number) => {
    const problem = problemsList[index];
    if (!problem) return;
    setProblemCursor(index);
    if (problem.file) selectStudioFile(problem.file, problem.line);
    openBottomPanel("problems");
  };
  const nextProblem = () => {
    if (problemsList.length === 0) return;
    goToProblem(problemCursor < 0 ? 0 : (problemCursor + 1) % problemsList.length);
  };
  const previousProblem = () => {
    if (problemsList.length === 0) return;
    goToProblem(
      problemCursor < 0
        ? problemsList.length - 1
        : (problemCursor - 1 + problemsList.length) % problemsList.length,
    );
  };
  // A new project is a new Problems context; a stale cursor from the
  // previous project must not drive the first Next/Previous here.
  useEffect(() => {
    setProblemCursor(-1);
  }, [projectId]);
  // Next/Previous Change: hunks for the open file, lifted from the Git
  // extension panel's scoped diff (StudioDiffHunk[]) — real git.diff data,
  // never a fake decoration.
  const [fileHunks, setFileHunks] = useState<StudioDiffHunk[]>([]);
  // Same -1 sentinel as problemCursor, for the same first-Next/first-Previous reason.
  const [changeCursor, setChangeCursor] = useState(-1);
  const changedLines = useMemo(
    () => [...new Set(fileHunks.flatMap((hunk) => hunk.changedLines))].sort((a, b) => a - b),
    [fileHunks],
  );
  const nextChange = () => {
    if (changedLines.length === 0) return;
    const index = changeCursor < 0 ? 0 : (changeCursor + 1) % changedLines.length;
    setChangeCursor(index);
    revealAt(changedLines[index]!);
  };
  const previousChange = () => {
    if (changedLines.length === 0) return;
    const index =
      changeCursor < 0
        ? changedLines.length - 1
        : (changeCursor - 1 + changedLines.length) % changedLines.length;
    setChangeCursor(index);
    revealAt(changedLines[index]!);
  };
  // Switching the selected file is a new Change-navigation context; a stale
  // cursor from the previous file's hunks must not drive the first jump here.
  useEffect(() => {
    setChangeCursor(-1);
  }, [selectedPath]);
  const showActivity = (next: string) => {
    if (next === activity && showTree && isMd) {
      setShowTree(false);
      return;
    }
    setActivity(next);
    setShowTree(true);
    setMobileView("files");
    if (next === "search") requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const openRoom = (next: "files" | "run" | "cloud" | "checks") => {
    selectTab(next);
    setMobileView("editor");
  };
  const openCheck = (id: StudioCheckId) => {
    selectChecksTab(id);
    setMobileView("editor");
  };
  const openDialog = (next: NonNullable<typeof dialog>, text = "") => {
    setDialogText(text);
    setDialog(next);
  };
  const reloadCurrentFile = () => {
    if (!selectedPath) return;
    if (isDirty && !window.confirm(t("unsavedConfirm"))) return;
    setBuffers((prev) => {
      const next = { ...prev };
      delete next[selectedPath];
      return next;
    });
    setDiskChangedPath((current) => (current === selectedPath ? null : current));
    void fileQuery.refetch();
  };
  const editorTextarea = () =>
    document.querySelector<HTMLTextAreaElement>("textarea[data-studio-editor]");
  const editorCommand = (command: "undo" | "redo") => {
    const area = editorTextarea();
    if (!area) return;
    area.focus();
    document.execCommand(command);
  };
  const findNextInEditor = () => {
    const area = editorTextarea();
    if (!area || !findText) return;
    const text = area.value;
    const from = area.selectionEnd ?? 0;
    let at = text.indexOf(findText, from);
    if (at < 0) at = text.indexOf(findText);
    if (at < 0) {
      setReplaceNote(t("replaceNone"));
      return;
    }
    area.focus();
    area.setSelectionRange(at, at + findText.length);
    const line = text.slice(0, at).split("\n").length;
    area.scrollTop = Math.max(0, (line - 1) * 19.375 - 60);
  };
  const openFind = () => {
    if (!selectedPath) return;
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
  };
  const revealAt = (line: number) => {
    setRevealLine(null);
    requestAnimationFrame(() => setRevealLine(line));
  };
  const goBack = () => {
    if (nav.index <= 0) return;
    const target = nav.stack[nav.index - 1];
    if (!target) return;
    setNav((prev) => ({ ...prev, index: prev.index - 1 }));
    selectStudioFile(target.path, target.line, true);
  };
  const goForward = () => {
    if (nav.index >= nav.stack.length - 1) return;
    const target = nav.stack[nav.index + 1];
    if (!target) return;
    setNav((prev) => ({ ...prev, index: prev.index + 1 }));
    selectStudioFile(target.path, target.line, true);
  };
  const [hasLastEdit, setHasLastEdit] = useState(false);
  const lastEditRef = useRef<{ path: string; line: number } | null>(null);
  const goToLastEdit = () => {
    const location = lastEditRef.current;
    if (!location) return;
    selectStudioFile(location.path, location.line);
  };
  const closeAllFiles = () => {
    if (anyStudioBufferDirty(buffersRef.current) && !window.confirm(t("unsavedConfirm"))) return;
    setOpenFiles([]);
    setBuffers({});
    setSelectedPath(null);
    setDiskChangedPath(null);
    router.replace(`${pathname}${buildStudioSearch({ tab: "files", projectId })}`);
  };
  const dirtyCount = Object.values(buffers).filter((b) => studioBufferIsDirty(b)).length;
  const isReadOnlySource = Boolean(treeQuery.data?.source) || !hasRoot;
  const filePaths = useMemo(
    () => (treeQuery.data ? flattenStudioTree(treeQuery.data.tree) : []),
    [treeQuery.data],
  );

  const saveAll = useMutation({
    mutationFn: async () => {
      const dirty = Object.entries(buffersRef.current).filter(([, b]) => studioBufferIsDirty(b));
      for (const [path, buffer] of dirty) {
        await apiPut("/api/v1/studio/file", {
          projectId,
          path,
          content: buffer.draft,
          expectedHash:
            path === selectedPath && fileQuery.data?.contentHash
              ? fileQuery.data.contentHash
              : await sha256Hex(buffer.saved),
        });
        setBuffers((prev) => markStudioFileSaved(prev, path));
      }
    },
    onSettled: () => {
      void fileQuery.refetch();
      void treeQuery.refetch();
    },
  });

  const createFile = useMutation({
    mutationFn: (path: string) =>
      apiPut<{ path: string }>("/api/v1/studio/file", { projectId, path, content: "" }),
    onSuccess: (_data, path) => {
      setDialog(null);
      void treeQuery.refetch();
      selectStudioFile(path);
    },
  });

  // VS Code shortcuts. Editor-scoped ones (find, go to line) only fire when
  // focus is inside Studio so the browser's own shortcuts keep working elsewhere.
  const shortcutRef = useRef({
    canSave: false,
    save: () => {},
    saveAll: () => {},
    terminal: () => {},
    togglePanel: () => {},
    toggleTree: () => {},
    toggleSide: () => {},
    quickOpen: () => {},
    goToLine: () => {},
    goToSymbol: () => {},
    find: () => {},
    rename: () => {},
    activity: (_: string) => {},
    git: () => {},
    problems: () => {},
    replaceAll: () => {},
    back: () => {},
    forward: () => {},
    lastEdit: () => {},
    nextProblem: () => {},
    previousProblem: () => {},
    nextChange: () => {},
    previousChange: () => {},
    newTerminal: () => {},
    splitTerminal: () => {},
  });
  shortcutRef.current = {
    canSave:
      Boolean(selectedPath && currentBuffer && isDirty) &&
      !saveFile.isPending &&
      !fileQuery.data?.truncated &&
      !fileQuery.data?.readOnly,
    save: () => saveFile.mutate(),
    saveAll: () => {
      if (dirtyCount > 0 && !isReadOnlySource) saveAll.mutate();
    },
    terminal: () =>
      showBottom && bottomPanel === "terminal" ? closeBottomPanel() : openBottomPanel("terminal"),
    togglePanel: () => (showBottom ? closeBottomPanel() : openBottomPanel(bottomPanel)),
    toggleTree: () => setShowTree((v) => !v),
    toggleSide: () => setShowSideChoice(!showSide),
    quickOpen: () => projectId && openDialog("quickOpen"),
    goToLine: () => selectedPath && openDialog("goToLine"),
    goToSymbol: () => selectedPath && openDialog("goToSymbol"),
    find: openFind,
    rename: () => selectedPath && hasRoot && openDialog("rename", selectedPath),
    activity: showActivity,
    git: () => {
      const git = barExtensions.find((e) => e.manifest.id === "arletos.git");
      if (git) showActivity("ext:arletos.git");
      else {
        showActivity("extensions");
        setExtensionDetailId("arletos.git");
      }
    },
    problems: () => openBottomPanel("problems"),
    replaceAll: () => hasRoot && setReplaceAllOpen(true),
    back: goBack,
    forward: goForward,
    lastEdit: goToLastEdit,
    nextProblem,
    previousProblem,
    nextChange,
    previousChange,
    newTerminal: () => {
      openBottomPanel("terminal");
      setTerminalNewSignal((n) => n + 1);
    },
    splitTerminal: () => setSplitTerminal((v) => !v),
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const sc = shortcutRef.current;
      if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("[data-studio-root]")) {
          event.preventDefault();
          sc.rename();
        }
        return;
      }
      if (event.key === "F8" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("[data-studio-root]")) {
          event.preventDefault();
          if (event.shiftKey) sc.previousProblem();
          else sc.nextProblem();
        }
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("[data-studio-root]")) {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            sc.back();
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            sc.forward();
            return;
          }
        }
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const inStudio = Boolean(
        (event.target as HTMLElement | null)?.closest?.("[data-studio-root]"),
      );
      if (key === "s" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (sc.canSave) sc.save();
      } else if (key === "s" && event.altKey) {
        event.preventDefault();
        sc.saveAll();
      } else if (event.code === "Backquote" && event.shiftKey) {
        event.preventDefault();
        sc.newTerminal();
      } else if (event.code === "Backquote") {
        event.preventDefault();
        sc.terminal();
      } else if (event.code === "Digit5" && event.shiftKey) {
        event.preventDefault();
        sc.splitTerminal();
      } else if (event.code === "Period" && event.altKey) {
        event.preventDefault();
        sc.nextChange();
      } else if (event.code === "Comma" && event.altKey) {
        event.preventDefault();
        sc.previousChange();
      } else if (key === "j" && !event.shiftKey) {
        event.preventDefault();
        sc.togglePanel();
      } else if (key === "b" && event.altKey) {
        event.preventDefault();
        sc.toggleSide();
      } else if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        sc.toggleTree();
      } else if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        sc.quickOpen();
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        sc.activity("search");
      } else if (key === "e" && event.shiftKey) {
        event.preventDefault();
        sc.activity("explorer");
      } else if (key === "g" && event.shiftKey) {
        event.preventDefault();
        sc.git();
      } else if (key === "x" && event.shiftKey) {
        event.preventDefault();
        sc.activity("extensions");
      } else if (key === "m" && event.shiftKey) {
        event.preventDefault();
        sc.problems();
      } else if (key === "o" && event.shiftKey && inStudio) {
        event.preventDefault();
        sc.goToSymbol();
      } else if (key === "g" && inStudio) {
        event.preventDefault();
        sc.goToLine();
      } else if (key === "h" && event.shiftKey) {
        event.preventDefault();
        sc.replaceAll();
      } else if ((key === "f" || key === "h") && inStudio) {
        event.preventDefault();
        sc.find();
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

  const sideW = isLg ? 340 : 320;
  const sectionDisplay = (view: typeof mobileView, visible = true) =>
    isMd ? (visible ? "flex" : "none") : mobileView === view ? "flex" : "none";
  const gridColumns = isMd
    ? `auto minmax(0, 1fr)${showSide ? ` ${sideW}px` : ""}`
    : "minmax(0, 1fr)";
  const gridRows = isMd ? (showBottom ? "minmax(0, 1fr) 230px" : "minmax(0, 1fr)") : "minmax(0, 1fr)";
  const gridAreas = isMd
    ? showBottom
      ? `"tree editor${showSide ? " side" : ""}" "tree bottom${showSide ? " side" : ""}"`
      : `"tree editor${showSide ? " side" : ""}"`
    : '"main"';
  const githubInstallHref = projectId
    ? `${resolveApiUrl()}/api/v1/github/install?projectId=${encodeURIComponent(projectId)}&returnTo=studio&locale=${encodeURIComponent(locale)}`
    : null;
  const roomTitle =
    workspaceTab === "run"
      ? t("menu.runPanel")
      : workspaceTab === "cloud"
        ? t("tab.cloud")
        : workspaceTab === "checks"
          ? `${t("tab.checks")} › ${t(`checksTab.${checksTab}`)}`
          : null;

  const studioMenus: StudioMenuDef[] = [
    {
      id: "file",
      label: t("menu.file"),
      items: [
        { id: "newFile", label: t("menu.newFile"), disabled: !hasRoot, onSelect: () => openDialog("newFile") },
        {
          id: "newFolder",
          label: t("menu.newFolder"),
          disabled: !hasRoot,
          onSelect: () => {
            setActivity("explorer");
            setShowTree(true);
            setMobileView("files");
            setShowNewFolder(true);
          },
        },
        { id: "quickOpen", label: t("menu.quickOpen"), shortcut: "Ctrl+P", dividerBefore: true, disabled: !projectId, onSelect: () => openDialog("quickOpen") },
        {
          id: "openProject",
          label: t("menu.openProject"),
          onSelect: () =>
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>("[data-studio-project] [role='combobox']")?.click(),
            ),
        },
        { id: "save", label: t("menu.save"), shortcut: "Ctrl+S", dividerBefore: true, disabled: !shortcutRef.current.canSave, onSelect: () => saveFile.mutate() },
        { id: "saveAll", label: t("menu.saveAll"), shortcut: "Ctrl+Alt+S", disabled: dirtyCount === 0 || isReadOnlySource, onSelect: () => saveAll.mutate() },
        { id: "reload", label: t("menu.reload"), disabled: !selectedPath, onSelect: reloadCurrentFile },
        { id: "rename", label: t("menu.rename"), shortcut: "F2", dividerBefore: true, disabled: !selectedPath || !hasRoot, onSelect: () => openDialog("rename", selectedPath ?? "") },
        {
          id: "deleteFile",
          label: t("menu.deleteFile"),
          disabled: !selectedPath || !hasRoot,
          onSelect: () => {
            if (selectedPath && window.confirm(t("menu.deleteConfirm", { path: selectedPath }))) {
              deleteFile.mutate(selectedPath);
            }
          },
        },
        { id: "linkFolder", label: t("menu.linkFolder"), dividerBefore: true, disabled: !projectId, onSelect: () => openDialog("linkFolder") },
        ...(githubInstallHref
          ? [{ id: "connectGithub", label: t("menu.connectGithub"), externalHref: githubInstallHref }]
          : []),
        { id: "closeFile", label: t("menu.closeFile"), dividerBefore: true, disabled: !selectedPath, onSelect: () => selectedPath && closeStudioFile(selectedPath) },
        { id: "closeAll", label: t("menu.closeAll"), disabled: openFiles.length === 0, onSelect: closeAllFiles },
        { id: "exit", label: t("menu.exit"), dividerBefore: true, href: WEB_NAV_PATHS.dashboard },
      ],
    },
    {
      id: "edit",
      label: t("menu.edit"),
      items: [
        { id: "undo", label: t("menu.undo"), shortcut: "Ctrl+Z", disabled: !selectedPath, onSelect: () => editorCommand("undo") },
        { id: "redo", label: t("menu.redo"), shortcut: "Ctrl+Y", disabled: !selectedPath, onSelect: () => editorCommand("redo") },
        { id: "find", label: t("menu.find"), shortcut: "Ctrl+F", dividerBefore: true, disabled: !selectedPath, onSelect: openFind },
        { id: "replace", label: t("menu.replace"), shortcut: "Ctrl+H", disabled: !selectedPath || Boolean(fileQuery.data?.readOnly), onSelect: openFind },
        { id: "searchAll", label: t("menu.searchAll"), shortcut: "Ctrl+Shift+F", dividerBefore: true, disabled: !hasRoot, onSelect: () => showActivity("search") },
        { id: "replaceAll", label: t("menu.replaceAll"), shortcut: "Ctrl+Shift+H", disabled: !hasRoot, onSelect: () => setReplaceAllOpen(true) },
        { id: "goToLine", label: t("menu.goToLine"), shortcut: "Ctrl+G", dividerBefore: true, disabled: !selectedPath, onSelect: () => openDialog("goToLine") },
        { id: "goToSymbol", label: t("menu.goToSymbol"), shortcut: "Ctrl+Shift+O", disabled: !selectedPath, onSelect: () => openDialog("goToSymbol") },
        { id: "back", label: t("menu.back"), shortcut: "Alt+Left", dividerBefore: true, disabled: nav.index <= 0, onSelect: goBack },
        { id: "forward", label: t("menu.forward"), shortcut: "Alt+Right", disabled: nav.index >= nav.stack.length - 1, onSelect: goForward },
        { id: "lastEdit", label: t("menu.lastEditLocation"), disabled: !hasLastEdit, onSelect: goToLastEdit },
        { id: "nextProblem", label: t("menu.nextProblem"), shortcut: "F8", dividerBefore: true, disabled: problemsList.length === 0, onSelect: nextProblem },
        { id: "previousProblem", label: t("menu.previousProblem"), shortcut: "Shift+F8", disabled: problemsList.length === 0, onSelect: previousProblem },
        { id: "nextChange", label: t("menu.nextChange"), shortcut: "Ctrl+Alt+.", dividerBefore: true, disabled: changedLines.length === 0, onSelect: nextChange },
        { id: "previousChange", label: t("menu.previousChange"), shortcut: "Ctrl+Alt+,", disabled: changedLines.length === 0, onSelect: previousChange },
      ],
    },
    {
      id: "view",
      label: t("menu.view"),
      items: [
        { id: "explorer", label: t("activity.explorer"), shortcut: "Ctrl+Shift+E", checked: showTree && activity === "explorer", onSelect: () => showActivity("explorer") },
        { id: "search", label: t("activity.search"), shortcut: "Ctrl+Shift+F", checked: showTree && activity === "search", onSelect: () => showActivity("search") },
        ...barExtensions.map((e) => ({
          id: `ext-${e.manifest.id}`,
          label: tExt("openPanel", { name: extName(e.manifest.id) }),
          ...(e.manifest.id === "arletos.git" ? { shortcut: "Ctrl+Shift+G" } : {}),
          checked: showTree && activity === `ext:${e.manifest.id}`,
          onSelect: () => showActivity(`ext:${e.manifest.id}`),
        })),
        { id: "extensions", label: tExt("title"), shortcut: "Ctrl+Shift+X", checked: showTree && activity === "extensions", onSelect: () => showActivity("extensions") },
        { id: "problems", label: t("problems.title"), shortcut: "Ctrl+Shift+M", dividerBefore: true, checked: showBottom && bottomPanel === "problems", onSelect: () => openBottomPanel("problems") },
        { id: "terminal", label: t("tab.pty"), shortcut: "Ctrl+`", checked: showBottom && bottomPanel === "terminal", onSelect: () => openBottomPanel("terminal") },
        ...(["agent", "chat", "patches", "psa"] as const).map((id, index) => ({
          id: `side-${id}`,
          label: t(`side.${id}`),
          dividerBefore: index === 0,
          checked: showSide && sidePanel === id,
          onSelect: () => openSidePanel(id),
        })),
        { id: "toggleSidebar", label: t("menu.toggleSidebar"), shortcut: "Ctrl+B", dividerBefore: true, onSelect: () => setShowTree((v) => !v) },
        { id: "togglePanel", label: t("menu.togglePanel"), shortcut: "Ctrl+J", onSelect: () => shortcutRef.current.togglePanel() },
        { id: "toggleAgent", label: t("menu.toggleAgent"), shortcut: "Ctrl+Alt+B", onSelect: () => setShowSideChoice(!showSide) },
        { id: "codeTools", label: t("menu.codeTools"), dividerBefore: true, checked: codeToolsOpen, disabled: !selectedPath, onSelect: () => setCodeToolsOpen((v) => !v) },
      ],
    },
    {
      id: "run",
      label: t("menu.run"),
      active: workspaceTab === "run",
      items: [
        { id: "runPanel", label: t("menu.runPanel"), checked: workspaceTab === "run", onSelect: () => openRoom("run") },
        { id: "terminal", label: t("tab.pty"), shortcut: "Ctrl+`", onSelect: () => openBottomPanel("terminal") },
        { id: "newTerminal", label: t("menu.newTerminal"), shortcut: "Ctrl+Shift+`", onSelect: () => { openBottomPanel("terminal"); setTerminalNewSignal((n) => n + 1); } },
        { id: "splitTerminal", label: t("menu.splitTerminal"), shortcut: "Ctrl+Shift+5", checked: splitTerminal, onSelect: () => setSplitTerminal((v) => !v) },
        { id: "askAgent", label: t("menu.askAgent"), dividerBefore: true, onSelect: () => openSidePanel("agent") },
        { id: "clone", label: t("menu.clone"), disabled: !projectId, onSelect: () => openDialog("clone") },
        ...(projectId
          ? [{ id: "projectState", label: t("projectState"), dividerBefore: true, href: `/projects/${projectId}/state` }]
          : []),
      ],
    },
    {
      id: "cloud",
      label: t("menu.cloud"),
      active: workspaceTab === "cloud",
      items: [
        { id: "cloudTools", label: t("tab.cloud"), checked: workspaceTab === "cloud", onSelect: () => openRoom("cloud") },
        ...(githubInstallHref
          ? [
              {
                id: "github",
                label: treeQuery.data?.source ? t("menu.manageGithub") : t("menu.connectGithub"),
                dividerBefore: true,
                externalHref: githubInstallHref,
              },
            ]
          : []),
        { id: "integrations", label: tNav("integrations"), dividerBefore: !githubInstallHref, href: "/settings?view=integrations" },
        { id: "byo", label: t("menu.byo"), href: "/settings?view=plan" },
      ],
    },
    {
      id: "checks",
      label: t("menu.checks"),
      active: workspaceTab === "checks",
      items: [
        ...STUDIO_CHECK_IDS.map((id, index) => ({
          id,
          label: t(`checksTab.${id}`),
          dividerBefore: index === 7,
          checked: workspaceTab === "checks" && checksTab === id,
          onSelect: () => openCheck(id),
        })),
        { id: "backToFiles", label: t("menu.backToFiles"), dividerBefore: true, disabled: workspaceTab === "files", onSelect: () => openRoom("files") },
      ],
    },
    {
      id: "dashboard",
      label: t("menu.dashboard"),
      items: [
        { id: "overview", label: tHub("overview"), href: WEB_NAV_PATHS.dashboard },
        { id: "projects", label: tNav("projects"), href: "/?view=projects" },
        { id: "systems", label: tNav("systems"), href: "/?view=systems" },
        { id: "insights", label: tHub("insights"), href: "/?view=insights" },
        { id: "activity", label: tHub("activity"), href: "/?view=activity" },
        { id: "agents", label: tNav("agents"), dividerBefore: true, href: "/agents" },
        { id: "experts", label: tNav("experts"), href: "/agents?view=experts" },
        { id: "models", label: tNav("models"), href: "/agents?view=models" },
        { id: "artifacts", label: tHub("artifacts"), href: "/agents?view=artifacts" },
        { id: "knowledge", label: tHub("knowledge"), href: "/agents?view=knowledge" },
        { id: "intelligence", label: tHub("intelligence"), href: "/agents?view=intelligence" },
        { id: "account", label: tNav("settings"), dividerBefore: true, href: "/settings" },
        { id: "plan", label: tHub("plan"), href: "/settings?view=plan" },
        { id: "integrations", label: tNav("integrations"), href: "/settings?view=integrations" },
        { id: "partners", label: tNav("partners"), href: "/settings?view=partners" },
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      items: [
        { id: "about", label: t("menu.howItWorks"), onSelect: () => openDialog("about") },
        { id: "shortcuts", label: t("menu.shortcuts"), onSelect: () => openDialog("shortcuts") },
      ],
    },
  ];

  /** Panels the official manifests point at — existing ArletOS capabilities only (ADR-026). */
  const renderExtensionPanel = (id: string, scope: StudioExtensionScope): ReactNode => {
    switch (id) {
      case "arletos.git":
        return (
          <StudioGitStatus
            projectId={projectId}
            onOpenFile={(path) => selectStudioFile(path)}
            filePath={selectedPath}
            onFileHunksChange={(hunks) => setFileHunks([...hunks])}
            extensionScope={scope}
          />
        );
      case "arletos.tests":
        return <QaPanel projectId={projectId} embedded extensionScope={scope} />;
      case "arletos.cloud":
        return (
          <Stack spacing={2}>
            <CloudToolsPanel embedded extensionScope={scope} />
            <DeployFeedsPanel projectId={projectId} embedded extensionScope={scope} />
          </Stack>
        );
      case "arletos.security":
        return <SentinelPanel projectId={projectId} embedded extensionScope={scope} />;
      case "arletos.observer":
        return <ObserverPanel projectId={projectId} embedded extensionScope={scope} />;
      case "arletos.agent-runs":
        return <EngineeringRunsPanel projectId={projectId} embedded extensionScope={scope} />;
      case "arletos.debugger":
        return <StudioDebugPanel projectId={projectId} extensionScope={scope} />;
      default:
        return null;
    }
  };

  const projectPicker = (
    <TextField
      select
      size="small"
      data-studio-project
      value={projectId}
      onChange={(e) => {
        const id = e.target.value;
        if (anyStudioBufferDirty(buffersRef.current) && !window.confirm(t("unsavedConfirm"))) {
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
          `${pathname}${buildStudioSearch({ tab, check: checksTab, projectId: id })}`,
        );
      }}
      SelectProps={{
        displayEmpty: true,
        renderValue: (value) => {
          const id = String(value ?? "");
          if (!id) return <span style={{ color: muted }}>{t("menu.openProject")}</span>;
          const project = projects.find((p) => p.id === id);
          return project?.name ?? (projectsQuery.isPending ? t("loadingProjects") : id);
        },
      }}
      inputProps={{ "aria-label": t("project") }}
      sx={{
        width: { xs: "100%", md: 380 },
        minWidth: 0,
        maxWidth: "100%",
        "& .MuiOutlinedInput-root": {
          height: 28,
          fontSize: 13,
          color: ink,
          bgcolor: editorBg,
          "& fieldset": { borderColor: "#30343C" },
        },
        "& .MuiSelect-select": { py: 0, textAlign: "center" },
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
  );

  const activityButton = (
    id: string,
    icon: ReactNode,
    label: string = t(`activity.${id}`),
    onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void,
  ) => (
    <Tooltip key={id} title={label} placement="left">
      <IconButton
        aria-label={label}
        {...(onContextMenu ? { onContextMenu } : {})}
        aria-pressed={showTree && activity === id}
        onClick={() => showActivity(id)}
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          color: showTree && activity === id ? inkStrong : muted,
          borderInlineStart:
            showTree && activity === id ? "2px solid #4C8DFF" : "2px solid transparent",
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  return (
    <ThemeProvider theme={studioTheme}>
    <Box
      data-studio-root
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        color: ink,
        textAlign: "start",
        bgcolor: "#15171C",
      }}
    >
      <Typography
        variant="h1"
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          p: 0,
          m: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
          fontSize: 16,
        }}
      >
        {t("title")}
      </Typography>
      <StudioMenuBar
        ariaLabel={t("menu.bar")}
        menus={studioMenus}
        center={projectPicker}
        end={
          <>
            <Tooltip title={t("menu.howItWorks")}>
              <IconButton
                size="small"
                aria-label={t("menu.howItWorks")}
                onClick={() => openDialog("about")}
                sx={{ color: ink }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <LanguageSwitcher tone="dark" dense menuId="atlas-lang-menu-studio" />
          </>
        }
      />
      {projectsQuery.isError ? (
        <Alert severity="error" sx={{ m: 1.5 }}>
          {(projectsQuery.error as Error).message}
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: gridColumns,
            gridTemplateRows: gridRows,
            gridTemplateAreas: gridAreas,
          }}
        >
          <Box
            sx={{
              gridArea: isMd ? "editor" : "main",
              minWidth: 0,
              minHeight: 0,
              display: sectionDisplay("editor"),
              flexDirection: "column",
              bgcolor: editorBg,
              overflow: "hidden",
            }}
          >
            {extensionDetailId ? (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 1.5, minHeight: 35, bgcolor: "#15171C", borderBottom: panelBorder, flexShrink: 0 }}
                >
                  <Typography component="h2" sx={{ flex: 1, fontSize: 13, color: inkStrong, fontWeight: 600 }}>
                    {tExt("detailTab", { name: extName(extensionDetailId) })}
                  </Typography>
                  <Tooltip title={t("menu.close")}>
                    <IconButton
                      size="small"
                      aria-label={t("menu.close")}
                      onClick={() => setExtensionDetailId(null)}
                      sx={{ color: muted }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box
                  tabIndex={0}
                  role="region"
                  aria-label={tExt("detailTab", { name: extName(extensionDetailId) })}
                  sx={{ flex: 1, minHeight: 0, overflow: "auto", outlineOffset: -2 }}
                >
                  <ExtensionDetail
                    projectId={projectId || null}
                    extensionId={extensionDetailId}
                    onOpenPanel={(id) => {
                      showActivity(`ext:${id}`);
                      setExtensionDetailId(null);
                    }}
                  />
                </Box>
              </>
            ) : roomTitle ? (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 1.5, minHeight: 35, bgcolor: "#15171C", borderBottom: panelBorder, flexShrink: 0 }}
                >
                  <Typography component="h2" sx={{ flex: 1, fontSize: 13, color: inkStrong, fontWeight: 600 }}>
                    {roomTitle}
                  </Typography>
                  <Tooltip title={t("menu.backToFiles")}>
                    <IconButton
                      size="small"
                      aria-label={t("menu.backToFiles")}
                      onClick={() => openRoom("files")}
                      sx={{ color: muted }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box
                  tabIndex={0}
                  role="region"
                  aria-label={roomTitle}
                  sx={{ flex: 1, minHeight: 0, overflow: "auto", outlineOffset: -2 }}
                >
                  {workspaceTab === "run" ? (
                    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                      {projectId ? (
                        <Stack spacing={3}>
                          <StudioRunPanel
                            projectId={projectId}
                            onManageExtensions={() => showActivity("extensions")}
                          />
                          <EngineeringRunsPanel projectId={projectId} embedded />
                        </Stack>
                      ) : (
                        pickProjectState
                      )}
                    </Box>
                  ) : null}
                  {workspaceTab === "cloud" ? (
                    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                      <Stack spacing={3}>
                        <CloudToolsPanel embedded />
                        {projectId ? <DeployFeedsPanel projectId={projectId} embedded /> : null}
                      </Stack>
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
            {checksTab === "constitution" ? (
              <ConstitutionPanel projectId={projectId} embedded />
            ) : null}
            {checksTab === "benchmarks" ? (
              <BenchmarksPanel projectId={projectId} embedded />
            ) : null}
          </Stack>

                  ) : null}
                </Box>
              </>
            ) : (
              <>
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
                  sx={{ px: 1.5, minHeight: 26, borderBottom: panelBorder, flexShrink: 0 }}
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
                  {fileQuery.data?.truncated ? (
                    <Chip size="small" label={t("fileTruncated")} sx={{ height: 20 }} />
                  ) : null}
                  {fileQuery.data?.readOnly && !fileQuery.data?.truncated ? (
                    <Typography variant="caption" sx={{ color: muted }}>
                      {t("menu.readOnly")}
                    </Typography>
                  ) : null}
                </Stack>
                {findOpen && selectedPath ? (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                    role="search"
                    aria-label={t("menu.find")}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setFindOpen(false);
                        editorTextarea()?.focus();
                      }
                    }}
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      borderBottom: panelBorder,
                      bgcolor: "#1F2228",
                      flexShrink: 0,
                    }}
                  >
                    <TextField
                      size="small"
                      inputRef={findInputRef}
                      label={t("findInFile")}
                      value={findText}
                      onChange={(event) => {
                        setFindText(event.target.value);
                        setReplaceNote(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          findNextInEditor();
                        }
                      }}
                      sx={{ minWidth: 140, flex: 1, ...fieldSx }}
                    />
                    <Button size="small" variant="outlined" disabled={!findText} onClick={findNextInEditor}>
                      {t("menu.findNext")}
                    </Button>
                    {fileQuery.data && !fileQuery.data.readOnly ? (
                      <>
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
                      </>
                    ) : null}
                    <IconButton
                      size="small"
                      aria-label={t("menu.close")}
                      onClick={() => setFindOpen(false)}
                      sx={{ color: muted }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                    {replaceNote ? (
                      <Typography variant="caption" sx={{ width: "100%", color: muted }}>
                        {replaceNote}
                      </Typography>
                    ) : null}
                  </Stack>
                ) : null}
                <Collapse in={codeToolsOpen && Boolean(selectedPath)} unmountOnExit>
                  <Box sx={{ borderBottom: panelBorder }}>
                    {selectedPath && fileQuery.data && /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(selectedPath) ? (
                      <StudioLanguageBar
                        projectId={projectId}
                        path={selectedPath}
                        content={currentBuffer?.draft ?? fileQuery.data.content}
                        onOpen={(path, line) => selectStudioFile(path, line)}
                        cursorLine={cursorPosition.line}
                        cursorColumn={cursorPosition.column}
                      />
                    ) : null}
                    {outline.length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        flexWrap="wrap"
                        useFlexGap
                        aria-label={t("outline")}
                        sx={{ px: 1.5, py: 1 }}
                      >
                        {outline.slice(0, 16).map((symbol) => (
                          <Chip
                            key={`${symbol.kind}:${symbol.name}:${symbol.line}`}
                            size="small"
                            variant="outlined"
                            label={`${symbol.name}:${symbol.line}`}
                            onClick={() => revealAt(symbol.line)}
                            aria-label={`${symbol.kind} ${symbol.name}`}
                            sx={{ color: ink, borderColor: "rgba(232,234,238,0.2)" }}
                          />
                        ))}
                      </Stack>
                    ) : selectedPath && fileQuery.data ? (
                      <Typography variant="caption" sx={{ px: 1.5, py: 1, display: "block", color: muted }}>
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
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
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
                      const area = editorTextarea();
                      const position = area?.selectionStart ?? 0;
                      const line = value.slice(0, position).split("\n").length;
                      lastEditRef.current = { path: selectedPath, line };
                      setHasLastEdit(true);
                    }}
                    languageHint={fileQuery.data.languageHint}
                    readOnly={
                      Boolean(fileQuery.data.truncated) ||
                      fileQuery.data.readOnly
                    }
                    ariaLabel={selectedPath ?? t("pickFile")}
                    revealLine={revealLine}
                    changedLines={changedLines}
                    onCursorChange={(line, column) => setCursorPosition({ line, column })}
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
              </>
            )}
          </Box>

          <Box
            component="section"
            aria-label={t("bottomPanel")}
            sx={{
              gridArea: isMd ? "bottom" : "main",
              minWidth: 0,
              minHeight: 0,
              display: sectionDisplay("panel", showBottom),
              flexDirection: "column",
              bgcolor: "#15171C",
              borderTop: panelBorder,
            }}
          >
            <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, pe: 0.5 }}>
              <Tabs
                value={bottomPanel}
                onChange={(_, v: typeof bottomPanel) => openBottomPanel(v)}
                aria-label={t("bottomPanel")}
                variant="scrollable"
                scrollButtons={false}
                sx={{ ...tabsSx(34), px: 0.5, flex: 1, minWidth: 0 }}
              >
                <Tab value="problems" label={t("problems.title")} />
                <Tab value="terminal" label={t("tab.pty")} />
              </Tabs>
              {bottomPanel === "terminal" ? (
                <Tooltip title={t("menu.splitTerminal")}>
                  <IconButton
                    size="small"
                    aria-label={t("menu.splitTerminal")}
                    aria-pressed={splitTerminal}
                    onClick={() => setSplitTerminal((v) => !v)}
                    sx={{ color: splitTerminal ? "#4C8DFF" : muted }}
                  >
                    <VerticalSplitIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip title={t("menu.closePanel")}>
                <IconButton
                  size="small"
                  aria-label={t("menu.closePanel")}
                  onClick={closeBottomPanel}
                  sx={{ color: muted, display: { xs: "none", md: "inline-flex" } }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
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
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={1}
                  sx={{ height: "100%" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <StudioPtyTerminal
                      projectId={projectId}
                      newSessionSignal={terminalNewSignal}
                      {...(splitTerminal ? { paneLabel: t("menu.splitPrimary") } : {})}
                    />
                  </Box>
                  {splitTerminal ? (
                    <Box sx={{ flex: 1, minWidth: 0, borderInlineStart: { md: panelBorder }, pt: { xs: 1, md: 0 } }}>
                      <StudioPtyTerminal
                        projectId={projectId}
                        restoreExistingSessions={false}
                        paneLabel={t("menu.splitSecondary")}
                      />
                    </Box>
                  ) : null}
                </Stack>
              ) : null}
            </Box>
          </Box>

          <Box
            component="section"
            aria-label={t("tree")}
            sx={{
              gridArea: isMd ? "tree" : "main",
              minWidth: 0,
              minHeight: 0,
              display: sectionDisplay("files"),
              bgcolor: panelBg,
              borderInlineEnd: { md: panelBorder },
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
              {activityButton("explorer", <FolderOutlinedIcon />)}
              {activityButton("search", <SearchIcon />)}
              {barExtensions.length > 0 ? (
                <Box sx={{ width: 26, height: "1px", bgcolor: "#30343C", my: 0.5 }} aria-hidden />
              ) : null}
              {barExtensions.map((e) =>
                activityButton(
                  `ext:${e.manifest.id}`,
                  <ExtensionIcon icon={e.manifest.contributes.activity?.icon ?? "extension"} />,
                  extName(e.manifest.id),
                  (event) => {
                    event.preventDefault();
                    setExtensionMenu({ id: e.manifest.id, anchor: event.currentTarget });
                  },
                ),
              )}
              {activityButton("extensions", <ExtensionOutlinedIcon />, tExt("title"))}
              <Menu
                anchorEl={extensionMenu?.anchor ?? null}
                open={Boolean(extensionMenu)}
                onClose={() => setExtensionMenu(null)}
                MenuListProps={{ dense: true, "aria-label": extensionMenu ? extName(extensionMenu.id) : "" }}
              >
                {extensionMenu
                  ? (() => {
                      const id = extensionMenu.id;
                      const ids = barExtensions.map((e) => e.manifest.id);
                      const index = ids.indexOf(id);
                      const move = (delta: number) => {
                        const next = [...ids];
                        const target = index + delta;
                        if (target < 0 || target >= next.length) return;
                        [next[index], next[target]] = [next[target]!, next[index]!];
                        extensionAction.mutate({ kind: "order", order: next });
                      };
                      const close = () => setExtensionMenu(null);
                      return [
                        <MenuItem key="open" onClick={() => { close(); showActivity(`ext:${id}`); }}>
                          {tExt("actions.open")}
                        </MenuItem>,
                        <MenuItem key="up" disabled={index <= 0} onClick={() => { close(); move(-1); }}>
                          {tExt("actions.moveUp")}
                        </MenuItem>,
                        <MenuItem key="down" disabled={index >= ids.length - 1} onClick={() => { close(); move(1); }}>
                          {tExt("actions.moveDown")}
                        </MenuItem>,
                        <Divider key="d" />,
                        <MenuItem key="details" onClick={() => { close(); setExtensionDetailId(id); }}>
                          {tExt("actions.details")}
                        </MenuItem>,
                        <MenuItem
                          key="disable"
                          onClick={() => {
                            close();
                            if (activity === `ext:${id}`) setActivity("explorer");
                            extensionAction.mutate({ kind: "disable", id });
                          }}
                        >
                          {tExt("actions.disable")}
                        </MenuItem>,
                      ];
                    })()
                  : null}
              </Menu>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t("menu.agentsLink")} placement="left">
                <IconButton
                  component={Link}
                  href="/agents"
                  aria-label={t("menu.agentsLink")}
                  sx={{ width: 40, height: 40, borderRadius: 1, color: muted }}
                >
                  <SmartToyOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("menu.account")} placement="left">
                <IconButton
                  aria-label={t("menu.account")}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(accountAnchor)}
                  onClick={(event) => setAccountAnchor(event.currentTarget)}
                  sx={{ width: 40, height: 40, borderRadius: 1, color: muted, mb: 1 }}
                >
                  <PersonOutlineIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={accountAnchor}
                open={Boolean(accountAnchor)}
                onClose={() => setAccountAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                MenuListProps={{ dense: true, "aria-label": t("menu.account") }}
              >
                {shell?.user ? (
                  <MenuItem disabled dir="ltr" sx={{ fontSize: 12.5 }}>
                    {shell.user.email}
                  </MenuItem>
                ) : null}
                <MenuItem component={Link} href="/settings" onClick={() => setAccountAnchor(null)}>
                  {tNav("settings")}
                </MenuItem>
                <MenuItem component={Link} href="/settings?view=plan" onClick={() => setAccountAnchor(null)}>
                  {tHub("plan")}
                </MenuItem>
                {shell ? <Divider /> : null}
                {shell ? (
                  <MenuItem
                    onClick={() => {
                      setAccountAnchor(null);
                      void shell.signOut();
                    }}
                  >
                    {tRoot("auth.logout")}
                  </MenuItem>
                ) : null}
              </Menu>
            </Stack>
            <Box
              tabIndex={0}
              role="region"
              aria-label={activityTitle}
              sx={{
                flex: 1,
                width: { md: activity.startsWith("ext:") || activity === "extensions" ? 330 : 260 },
                minWidth: 0,
                minHeight: 0,
                overflow: "auto",
                outlineOffset: -2,
                display: showTree || !isMd ? "block" : "none",
              }}
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
                {activityTitle}
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
            {activity === "explorer" && treeQuery.data?.source ? (
              <Box sx={{ px: 1.5, pb: 1 }}>
                <StudioGithubSourceBar projectId={projectId} source={treeQuery.data.source} />
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
              treeQuery.isLoading ? (
                <Typography variant="body2" sx={{ p: 2, color: muted }}>
                  {t("loadingTree")}
                </Typography>
              ) : (
                <Stack spacing={1.25} sx={{ p: 1.5 }}>
                  <Typography variant="body2" sx={{ color: muted }}>
                    {treeQuery.isError ? t("needRoot") : t("emptyTree")}
                  </Typography>
                  <StudioGithubSourceBar projectId={projectId} source={null} />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => openDialog("linkFolder")}
                    sx={{ alignSelf: "flex-start", textTransform: "none" }}
                  >
                    {t("menu.linkFolder")}
                  </Button>
                </Stack>
              )
            ) : null}
            {activity === "extensions" ? (
              <ExtensionsView
                projectId={projectId || null}
                selectedId={extensionDetailId}
                onSelect={(id) => {
                  setExtensionDetailId(id);
                  setMobileView("editor");
                }}
              />
            ) : null}
            {projectId && activeExtension ? (
              <ExtensionPanelHost
                entry={activeExtension}
                projectId={projectId}
                onOpenDetails={(id) => {
                  setExtensionDetailId(id);
                  setMobileView("editor");
                }}
                onLinkFolder={() => openDialog("linkFolder")}
              >
                {(scope) => <Box sx={{ px: 1 }}>{renderExtensionPanel(activeExtension.manifest.id, scope)}</Box>}
              </ExtensionPanelHost>
            ) : null}
            {!projectId && activeExtension ? (
              <Typography variant="body2" sx={{ p: 2, color: muted }}>
                {t("statusNoProject")}
              </Typography>
            ) : null}
            </Box>
          </Box>

          <Box
            component="aside"
            aria-label={t("sidePanel")}
            sx={{
              gridArea: isMd ? "side" : "main",
              minWidth: 0,
              minHeight: 0,
              display: sectionDisplay("agent", showSide),
              flexDirection: "column",
              bgcolor: panelBg,
              borderInlineStart: { md: panelBorder },
            }}
          >
            <Stack direction="row" alignItems="center" sx={{ borderBottom: panelBorder, flexShrink: 0, pe: 0.5 }}>
            <Tabs
              value={sidePanel}
              onChange={(_, v: typeof sidePanel) => openSidePanel(v)}
              aria-label={t("sidePanel")}
              variant="scrollable"
              scrollButtons={false}
              sx={{ ...tabsSx(38), px: 0.5, flex: 1, minWidth: 0 }}
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
            </Tabs>
            <Tooltip title={t("menu.closePanel")}>
              <IconButton
                size="small"
                aria-label={t("menu.closePanel")}
                onClick={() => setShowSideChoice(false)}
                sx={{ color: muted, display: { xs: "none", md: "inline-flex" } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            </Stack>
            <Box
              tabIndex={0}
              role="region"
              aria-label={t("sidePanel")}
              sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.75, outlineOffset: -2 }}
            >
            {!projectId && sidePanel !== "agent" ? (
              <Typography variant="body2" sx={{ color: muted }}>
                {t("statusNoProject")}
              </Typography>
            ) : null}
            {projectId && sidePanel === "psa" ? (
              <SupervisingAgentPanel projectId={projectId} selectedPath={selectedPath} />
            ) : null}

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

            </Box>
          </Box>
        </Box>
        <Box
          component="nav"
          aria-label={t("menu.mobileNav")}
          sx={{
            display: { xs: "grid", md: "none" },
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            bgcolor: chromeBg,
            borderTop: panelBorder,
            flexShrink: 0,
          }}
        >
          {(
            [
              ["files", <InsertDriveFileOutlinedIcon key="i" fontSize="small" />, t("menu.mobileFiles")],
              ["editor", <CodeIcon key="i" fontSize="small" />, t("menu.mobileEditor")],
              ["agent", <SmartToyOutlinedIcon key="i" fontSize="small" />, t("menu.mobileAgent")],
              ["panel", <TerminalIcon key="i" fontSize="small" />, t("menu.mobilePanel")],
            ] as const
          ).map(([id, icon, label]) => (
            <Button
              key={id}
              onClick={() => {
                setMobileView(id);
                if (id === "panel") setShowBottom(true);
              }}
              aria-pressed={mobileView === id}
              sx={{
                flexDirection: "column",
                gap: 0.25,
                minHeight: 52,
                borderRadius: 0,
                textTransform: "none",
                fontSize: 11,
                color: mobileView === id ? inkStrong : muted,
                boxShadow: mobileView === id ? "inset 0 2px 0 #4C8DFF" : "none",
              }}
            >
              {icon}
              {label}
            </Button>
          ))}
        </Box>
      </Box>

      {projectId && hasRoot ? (
        <ReplaceAllDialog
          projectId={projectId}
          open={replaceAllOpen}
          onClose={() => setReplaceAllOpen(false)}
          onApplied={() => {
            void treeQuery.refetch();
            void fileQuery.refetch();
          }}
        />
      ) : null}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth={dialog === "linkFolder" || dialog === "clone" || dialog === "about" ? "sm" : "xs"}
        PaperProps={{ sx: { bgcolor: "#1F2228", color: ink, border: "1px solid #30343C" } }}
      >
        {dialog === "quickOpen" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.quickOpen")}</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={t("menu.fileFilter")}
                value={dialogText}
                onChange={(e) => setDialogText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const needle = dialogText.trim().toLowerCase();
                  const first = filePaths.find((path) => path.toLowerCase().includes(needle));
                  if (first) {
                    e.preventDefault();
                    setDialog(null);
                    selectStudioFile(first);
                  }
                }}
                sx={{ mt: 1, ...fieldSx }}
              />
              <List dense sx={{ maxHeight: 320, overflow: "auto", mt: 1 }}>
                {filePaths
                  .filter((path) => path.toLowerCase().includes(dialogText.trim().toLowerCase()))
                  .slice(0, 50)
                  .map((path) => (
                    <ListItem key={path} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          setDialog(null);
                          selectStudioFile(path);
                        }}
                      >
                        <ListItemText
                          primary={studioFileBaseName(path)}
                          secondary={path}
                          primaryTypographyProps={{ fontSize: 13, dir: "ltr" }}
                          secondaryTypographyProps={{ fontSize: 11.5, color: muted, dir: "ltr", noWrap: true }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
              </List>
              {filePaths.length > 0 &&
              !filePaths.some((path) => path.toLowerCase().includes(dialogText.trim().toLowerCase())) ? (
                <Typography variant="body2" sx={{ color: muted }}>
                  {t("menu.noMatches")}
                </Typography>
              ) : null}
            </DialogContent>
          </>
        ) : null}

        {dialog === "goToLine" ? (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              const line = Number.parseInt(dialogText, 10);
              if (Number.isFinite(line) && line > 0) {
                setDialog(null);
                revealAt(line);
              }
            }}
          >
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.goToLine")}</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                fullWidth
                size="small"
                type="number"
                label={t("menu.lineNumber")}
                value={dialogText}
                onChange={(e) => setDialogText(e.target.value)}
                inputProps={{ min: 1 }}
                sx={{ mt: 1, ...fieldSx }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.cancel")}</Button>
              <Button type="submit" variant="contained">{t("menu.go")}</Button>
            </DialogActions>
          </Box>
        ) : null}

        {dialog === "goToSymbol" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.goToSymbol")}</DialogTitle>
            <DialogContent>
              {outline.length === 0 ? (
                <Typography variant="body2" sx={{ color: muted }}>{t("outlineEmpty")}</Typography>
              ) : (
                <List dense sx={{ maxHeight: 360, overflow: "auto" }}>
                  {outline.map((symbol) => (
                    <ListItem key={`${symbol.kind}:${symbol.name}:${symbol.line}`} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          setDialog(null);
                          revealAt(symbol.line);
                        }}
                      >
                        <ListItemText
                          primary={symbol.name}
                          secondary={`${symbol.kind} · ${symbol.line}`}
                          primaryTypographyProps={{ fontSize: 13, dir: "ltr" }}
                          secondaryTypographyProps={{ fontSize: 11.5, color: muted }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </DialogContent>
          </>
        ) : null}

        {dialog === "newFile" || dialog === "rename" ? (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              const path = dialogText.trim();
              if (!path) return;
              if (dialog === "newFile") {
                createFile.mutate(path);
                return;
              }
              if (path === selectedPath) return;
              if (isDirty && !window.confirm(t("unsavedConfirm"))) return;
              moveFile.mutate(path);
            }}
          >
            <DialogTitle sx={{ fontSize: 15 }}>
              {dialog === "newFile" ? t("menu.newFile") : t("menu.rename")}
            </DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={dialog === "newFile" ? t("menu.filePath") : t("moveTo")}
                value={dialogText}
                onChange={(e) => setDialogText(e.target.value)}
                inputProps={{ dir: "ltr" }}
                sx={{ mt: 1, ...fieldSx }}
              />
              {moveFile.isError && dialog === "rename" ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>{(moveFile.error as Error).message}</Alert>
              ) : null}
              {createFile.isError && dialog === "newFile" ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>{(createFile.error as Error).message}</Alert>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.cancel")}</Button>
              <Button
                type="submit"
                variant="contained"
                disabled={!dialogText.trim() || createFile.isPending || moveFile.isPending}
              >
                {dialog === "newFile" ? t("menu.create") : t("moveFile")}
              </Button>
            </DialogActions>
          </Box>
        ) : null}

        {dialog === "linkFolder" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.linkFolder")}</DialogTitle>
            <DialogContent>
              <LinkWorkspaceRoot
                projectId={projectId}
                currentRoot={selectedProject?.workspaceRoot}
                compact
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.close")}</Button>
            </DialogActions>
          </>
        ) : null}

        {dialog === "clone" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("cloneTitle")}</DialogTitle>
            <DialogContent>
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
            
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.close")}</Button>
            </DialogActions>
          </>
        ) : null}

        {dialog === "about" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.howItWorks")}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ color: inkStrong, fontWeight: 600 }}>
                {t("governanceShort")}
              </Typography>
              <Typography variant="body2" sx={{ color: ink, mt: 1 }}>
                {t("subtitle")}
              </Typography>
              <Typography variant="body2" sx={{ color: muted, mt: 1 }}>
                {t("agentPolicy")}
              </Typography>
              <Divider sx={{ my: 1.5, borderColor: "#30343C" }} />
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
              <Typography variant="caption" sx={{ color: muted, display: "block", mt: 1 }}>
                {t("projectHelp")}
              </Typography>
              <Box sx={{ mt: 1.5 }}>
                <AiCompanionBar />
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.close")}</Button>
            </DialogActions>
          </>
        ) : null}

        {dialog === "shortcuts" ? (
          <>
            <DialogTitle sx={{ fontSize: 15 }}>{t("menu.shortcuts")}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ color: muted, mb: 1 }}>
                {t("menu.shortcutsIntro")}
              </Typography>
              <Box
                component="dl"
                sx={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 2, rowGap: 0.75, m: 0, fontSize: 13 }}
              >
                {(
                  [
                    [t("menu.quickOpen"), "Ctrl+P"],
                    [t("menu.save"), "Ctrl+S"],
                    [t("menu.saveAll"), "Ctrl+Alt+S"],
                    [t("menu.find"), "Ctrl+F"],
                    [t("menu.replace"), "Ctrl+H"],
                    [t("menu.searchAll"), "Ctrl+Shift+F"],
                    [t("menu.replaceAll"), "Ctrl+Shift+H"],
                    [t("menu.goToLine"), "Ctrl+G"],
                    [t("menu.goToSymbol"), "Ctrl+Shift+O"],
                    [t("menu.back"), "Alt+Left"],
                    [t("menu.forward"), "Alt+Right"],
                    [t("menu.nextProblem"), "F8"],
                    [t("menu.previousProblem"), "Shift+F8"],
                    [t("menu.nextChange"), "Ctrl+Alt+."],
                    [t("menu.previousChange"), "Ctrl+Alt+,"],
                    [t("menu.newTerminal"), "Ctrl+Shift+`"],
                    [t("menu.splitTerminal"), "Ctrl+Shift+5"],
                    [t("menu.rename"), "F2"],
                    [t("activity.explorer"), "Ctrl+Shift+E"],
                    [extName("arletos.git"), "Ctrl+Shift+G"],
                    [tExt("title"), "Ctrl+Shift+X"],
                    [t("problems.title"), "Ctrl+Shift+M"],
                    [t("tab.pty"), "Ctrl+`"],
                    [t("menu.toggleSidebar"), "Ctrl+B"],
                    [t("menu.togglePanel"), "Ctrl+J"],
                    [t("menu.toggleAgent"), "Ctrl+Alt+B"],
                  ] as const
                ).map(([label, keys]) => (
                  <Box key={keys} sx={{ display: "contents" }}>
                    <Box component="dt" sx={{ m: 0 }}>{label}</Box>
                    <Box component="dd" dir="ltr" sx={{ m: 0, color: muted, fontFamily: "ui-monospace, monospace" }}>
                      {keys}
                    </Box>
                  </Box>
                ))}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)}>{t("menu.close")}</Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>

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
        {treeQuery.data?.source ? (
          <>
            <span dir="ltr">⎇ {treeQuery.data.source.ref}</span>
            <span dir="ltr">{treeQuery.data.source.repo}</span>
            <span>{t("menu.readOnly")}</span>
          </>
        ) : (
          <span>{selectedProject?.name ?? (projectId || t("statusNoProject"))}</span>
        )}
        {projectId && !hasRoot && !treeQuery.data?.source ? <span>{t("noRoot")}</span> : null}
        {dirtyCount > 0 ? <span>{t("unsavedCount", { count: dirtyCount })}</span> : null}
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          type="button"
          onClick={() => openRoom("run")}
          sx={{ all: "unset", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          {t("tab.run")}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => openRoom("checks")}
          sx={{ all: "unset", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          {t("tab.checks")}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => shortcutRef.current.togglePanel()}
          aria-pressed={showBottom}
          sx={{ all: "unset", cursor: "pointer", display: { xs: "none", md: "inline" }, "&:hover": { textDecoration: "underline" } }}
        >
          {t("problems.title")}
        </Box>
        {selectedPath ? (
          <span dir="ltr">{fileQuery.data?.languageHint ?? studioFileBaseName(selectedPath)}</span>
        ) : null}
      </Box>
    </Box>
    </ThemeProvider>
  );
}
