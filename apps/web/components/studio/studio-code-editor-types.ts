import type { Ref } from "react";
import type { StudioEditorHandle } from "@/lib/studio-editor-handle";

/** Props shared by every Studio code editor backend. */
export interface StudioCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  languageHint: string | null;
  readOnly: boolean;
  ariaLabel: string;
  revealLine?: number | null;
  /** Working-tree line numbers with an uncommitted change (git.diff), for a gutter marker. */
  changedLines?: readonly number[];
  /** Current cursor position (1-based), for tools that act at the cursor (Code tools: hover/definition/references/rename). */
  onCursorChange?: (line: number, column: number) => void;
  /** Debugger: lines with a breakpoint set (1-based). Independent of changedLines. */
  breakpointLines?: readonly number[];
  /** Debugger: the line currently paused at, if any (1-based). */
  stoppedLine?: number | null;
  /** Debugger: gutter click toggles a breakpoint on that line. Gutter stays read-only without this. */
  onBreakpointToggle?: (line: number) => void;
  /** Editor-neutral control surface; callers must use this instead of reaching into the DOM. */
  editorRef?: Ref<StudioEditorHandle>;
}
