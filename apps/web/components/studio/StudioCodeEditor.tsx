"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  STUDIO_EDITOR_BACKEND_KEY,
  STUDIO_EDITOR_NARROW_QUERY,
  resolveStudioEditorBackend,
  type StudioEditorBackend,
} from "@/lib/studio-editor-backend";
import { delegateStudioEditorHandle, type StudioEditorHandle } from "@/lib/studio-editor-handle";
import { StudioMonacoEditor } from "./StudioMonacoEditor";
import { StudioTextareaEditor } from "./StudioTextareaEditor";
import type { StudioCodeEditorProps } from "./studio-code-editor-types";

declare global {
  interface Window {
    /** Verification-only: present when NEXT_PUBLIC_STUDIO_EDITOR_TEST_SEAM=1 at build time. */
    __atlasStudioEditorTest?: {
      backend: () => StudioEditorBackend;
      getValue: () => string;
      getSelection: () => { start: number; end: number };
      getCursor: () => { line: number; column: number };
    };
  }
}

/**
 * The Studio code editor. Picks a backend and exposes one StudioEditorHandle
 * for whichever backend is mounted.
 *
 * The textarea is the default. Monaco is opt-in (localStorage, no UI) and only
 * on wide viewports. If Monaco cannot load, the textarea takes over.
 */
export function StudioCodeEditor(props: StudioCodeEditorProps) {
  const { editorRef, ...rest } = props;
  const [backend, setBackend] = useState<StudioEditorBackend>("textarea");
  const [monacoFailed, setMonacoFailed] = useState(false);
  const inner = useRef<StudioEditorHandle | null>(null);
  const backendRef = useRef(backend);

  useImperativeHandle(editorRef, () => delegateStudioEditorHandle(() => inner.current), []);

  useEffect(() => {
    const query = window.matchMedia(STUDIO_EDITOR_NARROW_QUERY);
    const apply = () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(STUDIO_EDITOR_BACKEND_KEY);
      } catch {
        // Storage can be blocked; the default backend applies.
      }
      setBackend(resolveStudioEditorBackend({ stored, narrow: query.matches }));
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // The breakpoint gutter exists only in the textarea backend for now.
  const needsGutterControls = Boolean(props.onBreakpointToggle || props.breakpointLines?.length);
  const active: StudioEditorBackend =
    backend === "monaco" && !monacoFailed && !needsGutterControls ? "monaco" : "textarea";
  backendRef.current = active;

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STUDIO_EDITOR_TEST_SEAM !== "1") return;
    const handle = delegateStudioEditorHandle(() => inner.current);
    window.__atlasStudioEditorTest = {
      backend: () => backendRef.current,
      getValue: () => handle.getValue(),
      getSelection: () => handle.getSelection(),
      getCursor: () => handle.getCursor(),
    };
    return () => {
      delete window.__atlasStudioEditorTest;
    };
  }, []);

  return active === "monaco" ? (
    <StudioMonacoEditor {...rest} editorRef={inner} onLoadFailed={() => setMonacoFailed(true)} />
  ) : (
    <StudioTextareaEditor {...rest} editorRef={inner} />
  );
}