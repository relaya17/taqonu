"use client";

import { Box } from "@mui/material";
import { useEffect, useImperativeHandle, useRef } from "react";
import {
  findNextStudioMatch,
  studioEditorScrollTop,
  type StudioEditorHandle,
} from "@/lib/studio-editor-handle";
import type { StudioCodeEditorProps } from "./studio-code-editor-types";
import {
  highlightStudioLine,
  lineColumnForStudioOffset,
  offsetForStudioLine,
  studioLineCount,
  studioSyntaxLanguage,
} from "@/lib/studio-syntax";

const TOKEN_COLOR: Record<string, string> = {
  keyword: "#7EB8FF",
  string: "#C3E88D",
  comment: "#6B7280",
  number: "#F78C6C",
  plain: "#DCDDE1",
};

/**
 * Accessible code surface: a real textarea remains the editor.
 * Highlighting is a visual overlay driven by API `languageHint`.
 * This is not a language service.
 */
export function StudioTextareaEditor({
  value,
  onChange,
  languageHint,
  readOnly,
  ariaLabel,
  revealLine,
  changedLines,
  onCursorChange,
  breakpointLines,
  stoppedLine,
  onBreakpointToggle,
  editorRef,
}: StudioCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = value.split("\n");
  const lineCount = studioLineCount(value);
  const language = studioSyntaxLanguage(languageHint);
  const changedLineSet = new Set(changedLines ?? []);
  const breakpointLineSet = new Set(breakpointLines ?? []);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  };

  const reportCursor = () => {
    const textarea = textareaRef.current;
    if (!textarea || !onCursorChange) return;
    const { line, column } = lineColumnForStudioOffset(value, textarea.selectionStart);
    onCursorChange(line, column);
  };

  const revealLineIn = (textarea: HTMLTextAreaElement, text: string, line: number) => {
    const offset = offsetForStudioLine(text, line);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    textarea.scrollTop = studioEditorScrollTop(line, 40);
    syncScroll();
  };

  useImperativeHandle(editorRef, () => {
    const area = () => textareaRef.current;
    return {
      focus: () => area()?.focus(),
      undo: () => {
        const textarea = area();
        if (!textarea) return;
        textarea.focus();
        document.execCommand("undo");
      },
      redo: () => {
        const textarea = area();
        if (!textarea) return;
        textarea.focus();
        document.execCommand("redo");
      },
      getValue: () => area()?.value ?? "",
      setValue: (next) => onChange(next),
      getCursor: () => {
        const textarea = area();
        return textarea
          ? lineColumnForStudioOffset(textarea.value, textarea.selectionStart)
          : { line: 1, column: 1 };
      },
      getSelection: () => {
        const textarea = area();
        return { start: textarea?.selectionStart ?? 0, end: textarea?.selectionEnd ?? 0 };
      },
      setSelection: (start, end) => area()?.setSelectionRange(start, end),
      revealLine: (line) => {
        const textarea = area();
        if (!textarea || line < 1) return;
        revealLineIn(textarea, textarea.value, line);
      },
      findNext: (needle) => {
        const textarea = area();
        if (!textarea || !needle) return false;
        const text = textarea.value;
        const at = findNextStudioMatch(text, needle, textarea.selectionEnd ?? 0);
        if (at < 0) return false;
        textarea.focus();
        textarea.setSelectionRange(at, at + needle.length);
        const line = text.slice(0, at).split("\n").length;
        textarea.scrollTop = studioEditorScrollTop(line, 60);
        return true;
      },
    } satisfies StudioEditorHandle;
  });

  useEffect(() => {
    if (!revealLine || revealLine < 1) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    revealLineIn(textarea, value, revealLine);
  }, [revealLine, value]);

  // Mobile single-pane layout hides this editor (display:none) behind the
  // Problems/Terminal view; a scrollTop set while hidden does not stick
  // (zero layout height), though the cursor/selection above already does.
  // Reapply the same reveal target once the pane is actually laid out again.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !revealLine || revealLine < 1) return;
    const observer = new ResizeObserver(() => {
      if (textarea.clientHeight === 0) return;
      textarea.scrollTop = studioEditorScrollTop(revealLine, 40);
      syncScroll();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [revealLine]);

  return (
    <Box
      dir="ltr"
      data-studio-editor-backend="textarea"
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "minmax(2.5rem, auto) 1fr",
        flex: 1,
        height: "100%",
        minHeight: 240,
        overflow: "hidden",
        bgcolor: "rgba(14,17,22,0.9)",
        unicodeBidi: "isolate",
      }}
    >
      <Box
        ref={gutterRef}
        aria-hidden={!onBreakpointToggle}
        sx={{
          overflow: "hidden",
          px: 1,
          py: 2,
          textAlign: "right",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "#6B7280",
          userSelect: "none",
          borderRight: "1px solid rgba(232,234,238,0.12)",
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => {
          const line = i + 1;
          const isBreakpoint = breakpointLineSet.has(line);
          const isStopped = stoppedLine === line;
          return (
            <Box
              key={line}
              component={onBreakpointToggle ? "button" : "div"}
              type={onBreakpointToggle ? "button" : undefined}
              aria-label={onBreakpointToggle ? `Toggle breakpoint on line ${line}` : undefined}
              onClick={onBreakpointToggle ? () => onBreakpointToggle(line) : undefined}
              sx={{
                display: "block",
                width: "100%",
                background: isStopped ? "rgba(255, 196, 0, 0.18)" : "none",
                border: 0,
                p: 0,
                m: 0,
                font: "inherit",
                color: isBreakpoint ? "#F07178" : "inherit",
                cursor: onBreakpointToggle ? "pointer" : "inherit",
                ...(changedLineSet.has(line)
                  ? { borderInlineStart: "2px solid #6FBF73", ps: "6px", ms: "-7px" }
                  : {}),
              }}
            >
              {isBreakpoint ? "● " : ""}
              {line}
            </Box>
          );
        })}
      </Box>
      <Box sx={{ position: "relative", minWidth: 0 }}>
        <Box
          ref={highlightRef}
          component="pre"
          aria-hidden
          sx={{
            m: 0,
            p: 2,
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: "pre",
            color: "#DCDDE1",
          }}
        >
          {lines.map((line, index) => (
            <Box key={index} component="div">
              {highlightStudioLine(line, language).map((token, tokenIndex) => (
                <Box
                  key={tokenIndex}
                  component="span"
                  sx={{ color: TOKEN_COLOR[token.kind] ?? TOKEN_COLOR.plain }}
                >
                  {token.text || " "}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        <Box
          ref={textareaRef}
          component="textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          onSelect={reportCursor}
          onClick={reportCursor}
          onKeyUp={reportCursor}
          readOnly={readOnly}
          data-studio-editor
          spellCheck={false}
          aria-label={ariaLabel}
          aria-readonly={readOnly}
          sx={{
            position: "relative",
            zIndex: 1,
            m: 0,
            p: 2,
            width: "100%",
            height: "100%",
            overflow: "auto",
            fontSize: 12.5,
            lineHeight: 1.55,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            bgcolor: "transparent",
            color: "transparent",
            caretColor: "#DCDDE1",
            border: 0,
            resize: "none",
            outline: "none",
            whiteSpace: "pre",
          }}
        />
      </Box>
    </Box>
  );
}
