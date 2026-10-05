"use client";

import { Box } from "@mui/material";
import { useEffect, useImperativeHandle, useRef } from "react";
import type * as Monaco from "monaco-editor/editor/editor.api";
import { monacoLanguageForStudio } from "@/lib/studio-editor-backend";
import { STUDIO_EDITOR_LINE_HEIGHT, type StudioEditorHandle } from "@/lib/studio-editor-handle";
import { loadStudioMonaco, type StudioMonaco } from "@/lib/studio-monaco";
import { lineColumnForStudioOffset, studioSyntaxLanguage } from "@/lib/studio-syntax";
import type { StudioCodeEditorProps } from "./studio-code-editor-types";

const THEME = "atlas-studio";
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** The Studio value is always LF, like a textarea's `.value`; offsets below are LF offsets too. */
const toLf = (text: string) => text.replace(/\r\n/g, "\n");

function defineTheme(monaco: StudioMonaco): void {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: false,
    rules: [
      { token: "", foreground: "DCDDE1" },
      { token: "keyword", foreground: "7EB8FF" },
      { token: "string", foreground: "C3E88D" },
      { token: "comment", foreground: "6B7280" },
      { token: "number", foreground: "F78C6C" },
    ],
    colors: {
      "editor.background": "#0E1116",
      "editor.foreground": "#DCDDE1",
      "editorLineNumber.foreground": "#6B7280",
      "editorLineNumber.activeForeground": "#9CA3AF",
      "editorCursor.foreground": "#DCDDE1",
      "editor.selectionBackground": "#264F78",
    },
  });
}

/**
 * Monaco backend for the Studio code editor. Opt-in and local-only: the
 * dispatcher in StudioCodeEditor chooses it. It implements the same
 * StudioEditorHandle as the textarea backend, so nothing above it changes.
 *
 * Out of scope for this backend for now: breakpoint gutter, multi-cursor,
 * split editor, inline diagnostics, Monaco's own find/suggest/hover UI.
 */
export function StudioMonacoEditor({
  value,
  onChange,
  languageHint,
  readOnly,
  ariaLabel,
  revealLine,
  changedLines,
  onCursorChange,
  editorRef,
  onLoadFailed,
}: StudioCodeEditorProps & { onLoadFailed: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorInstance = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<StudioMonaco | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const applyingExternal = useRef(false);

  // Latest props for the long-lived Monaco listeners.
  const latest = useRef({ value, onChange, onCursorChange, onLoadFailed, revealLine });
  latest.current = { value, onChange, onCursorChange, onLoadFailed, revealLine };

  const language = monacoLanguageForStudio(studioSyntaxLanguage(languageHint));

  const revealLineNow = (line: number) => {
    const editor = editorInstance.current;
    const model = editor?.getModel();
    if (!editor || !model || line < 1) return;
    const lineNumber = Math.min(line, model.getLineCount());
    editor.setPosition({ lineNumber, column: 1 });
    editor.revealLineNearTop(lineNumber, 1 /* ScrollType.Immediate */);
    editor.focus();
  };

  const lfOffset = (model: Monaco.editor.ITextModel, position: Monaco.IPosition): number =>
    model.getOffsetAt(position) - (position.lineNumber - 1) * (model.getEOL().length - 1);

  useImperativeHandle(editorRef, () => {
    const ctx = () => {
      const editor = editorInstance.current;
      const model = editor?.getModel();
      return editor && model ? { editor, model } : null;
    };
    return {
      focus: () => editorInstance.current?.focus(),
      undo: () => {
        const editor = editorInstance.current;
        if (!editor) return;
        editor.focus();
        editor.trigger("studio", "undo", null);
      },
      redo: () => {
        const editor = editorInstance.current;
        if (!editor) return;
        editor.focus();
        editor.trigger("studio", "redo", null);
      },
      getValue: () => {
        const c = ctx();
        return c ? c.model.getValue(1 /* EndOfLinePreference.LF */) : "";
      },
      setValue: (next) => latest.current.onChange(next),
      getCursor: () => {
        const position = editorInstance.current?.getPosition();
        return position
          ? { line: position.lineNumber, column: position.column }
          : { line: 1, column: 1 };
      },
      getSelection: () => {
        const c = ctx();
        const selection = c?.editor.getSelection();
        if (!c || !selection) return { start: 0, end: 0 };
        return {
          start: lfOffset(c.model, selection.getStartPosition()),
          end: lfOffset(c.model, selection.getEndPosition()),
        };
      },
      setSelection: (start, end) => {
        const c = ctx();
        const monaco = monacoRef.current;
        if (!c || !monaco) return;
        const text = c.model.getValue(1 /* EndOfLinePreference.LF */);
        const from = lineColumnForStudioOffset(text, start);
        const to = lineColumnForStudioOffset(text, end);
        c.editor.setSelection(
          new monaco.Selection(from.line, from.column, to.line, to.column),
        );
      },
      revealLine: (line) => revealLineNow(line),
      findNext: (needle) => {
        const c = ctx();
        if (!c || !needle) return false;
        const from = c.editor.getSelection()?.getEndPosition() ?? { lineNumber: 1, column: 1 };
        // Case-sensitive literal search that wraps once, like the textarea backend's indexOf.
        const match = c.model.findNextMatch(needle, from, false, true, null, false);
        if (!match) return false;
        c.editor.focus();
        c.editor.setSelection(match.range);
        c.editor.revealLineNearTop(match.range.startLineNumber, 1 /* ScrollType.Immediate */);
        return true;
      },
    } satisfies StudioEditorHandle;
  });

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose(): void }> = [];

    loadStudioMonaco()
      .then((monaco) => {
        const host = hostRef.current;
        if (disposed || !host) return;
        monacoRef.current = monaco;
        defineTheme(monaco);
        const editor = monaco.editor.create(host, {
          value: toLf(latest.current.value),
          language,
          theme: THEME,
          readOnly,
          domReadOnly: readOnly,
          ariaLabel,
          automaticLayout: true,
          fontFamily: FONT_FAMILY,
          fontSize: 12.5,
          lineHeight: STUDIO_EDITOR_LINE_HEIGHT,
          padding: { top: 16, bottom: 16 },
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 10,
          renderLineHighlight: "none",
          occurrencesHighlight: "off",
          selectionHighlight: false,
          matchBrackets: "never",
          contextmenu: false,
          quickSuggestions: false,
          hover: { enabled: "off" },
          // Screen readers need the document text in the input area.
          accessibilitySupport: "on",
          // Same as the textarea: Tab moves focus on, it does not insert a tab.
          tabFocusMode: true,
          unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
        });
        editorInstance.current = editor;
        const model = editor.getModel();
        if (!model) return;
        decorationsRef.current = editor.createDecorationsCollection([]);

        disposables.push(
          editor,
          editor.onDidChangeModelContent(() => {
            if (applyingExternal.current) return;
            latest.current.onChange(model.getValue(1 /* EndOfLinePreference.LF */));
          }),
          editor.onDidChangeCursorPosition((event) => {
            latest.current.onCursorChange?.(event.position.lineNumber, event.position.column);
          }),
        );
        const initialReveal = latest.current.revealLine;
        if (initialReveal && initialReveal >= 1) revealLineNow(initialReveal);
      })
      .catch(() => {
        if (!disposed) latest.current.onLoadFailed();
      });

    return () => {
      disposed = true;
      for (const disposable of disposables) disposable.dispose();
      editorInstance.current = null;
      decorationsRef.current = null;
    };
    // The editor is created once; later prop changes are applied by the effects below.
  }, []);

  // External value (file switch, replace-in-buffer, reload) into the model.
  useEffect(() => {
    const model = editorInstance.current?.getModel();
    if (!model) return;
    const next = toLf(value);
    if (model.getValue(1 /* EndOfLinePreference.LF */) === next) return;
    applyingExternal.current = true;
    try {
      model.setValue(next);
    } finally {
      applyingExternal.current = false;
    }
    if (latest.current.revealLine && latest.current.revealLine >= 1) {
      revealLineNow(latest.current.revealLine);
    }
  }, [value]);

  useEffect(() => {
    editorInstance.current?.updateOptions({ readOnly, domReadOnly: readOnly, ariaLabel });
  }, [readOnly, ariaLabel]);

  useEffect(() => {
    const model = editorInstance.current?.getModel();
    const monaco = monacoRef.current;
    if (model && monaco) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    decorationsRef.current?.set(
      (changedLines ?? []).map((line) => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: "studio-monaco-changed-line" },
      })),
    );
  }, [changedLines]);

  useEffect(() => {
    if (revealLine && revealLine >= 1) revealLineNow(revealLine);
  }, [revealLine]);

  return (
    <Box
      dir="ltr"
      data-studio-editor-backend="monaco"
      sx={{
        position: "relative",
        flex: 1,
        height: "100%",
        minHeight: 240,
        overflow: "hidden",
        bgcolor: "#0E1116",
        unicodeBidi: "isolate",
        "& .studio-monaco-changed-line": { borderInlineStart: "3px solid #6FBF73" },
      }}
    >
      <Box ref={hostRef} sx={{ position: "absolute", inset: 0 }} />
    </Box>
  );
}
