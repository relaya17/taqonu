"use client";

import { Box } from "@mui/material";
import { useEffect, useRef } from "react";
import {
  highlightStudioLine,
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
export function StudioCodeEditor({
  value,
  onChange,
  languageHint,
  readOnly,
  ariaLabel,
  revealLine,
}: {
  value: string;
  onChange: (next: string) => void;
  languageHint: string | null;
  readOnly: boolean;
  ariaLabel: string;
  revealLine?: number | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = value.split("\n");
  const lineCount = studioLineCount(value);
  const language = studioSyntaxLanguage(languageHint);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  };

  useEffect(() => {
    if (!revealLine || revealLine < 1) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const offset = offsetForStudioLine(value, revealLine);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const lineHeight = 19.375;
    textarea.scrollTop = Math.max(0, (revealLine - 1) * lineHeight - 40);
    syncScroll();
  }, [revealLine, value]);

  return (
    <Box
      dir="ltr"
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "minmax(2.5rem, auto) 1fr",
        flex: 1,
        minHeight: 240,
        maxHeight: 440,
        overflow: "hidden",
        bgcolor: "rgba(14,17,22,0.9)",
        unicodeBidi: "isolate",
      }}
    >
      <Box
        ref={gutterRef}
        aria-hidden
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
        {Array.from({ length: lineCount }, (_, i) => (
          <Box key={i + 1} component="div">
            {i + 1}
          </Box>
        ))}
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
          disabled={readOnly}
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
            maxHeight: 440,
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
