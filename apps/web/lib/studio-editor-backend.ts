import type { StudioSyntaxLanguage } from "@/lib/studio-syntax";

export type StudioEditorBackend = "textarea" | "monaco";

/** localStorage key that opts a browser into a backend. No UI sets it yet. */
export const STUDIO_EDITOR_BACKEND_KEY = "atlas.studio.editorBackend";

/** Below MUI's `md` breakpoint (900px) the single-pane mobile layout applies. */
export const STUDIO_EDITOR_NARROW_QUERY = "(max-width: 899.95px)";

/**
 * Textarea is the default. Monaco is opt-in and only on wide viewports: narrow
 * and touch layouts keep the textarea, which is natively accessible there.
 */
export function resolveStudioEditorBackend(input: {
  stored: string | null;
  narrow: boolean;
}): StudioEditorBackend {
  if (input.narrow) return "textarea";
  return input.stored === "monaco" ? "monaco" : "textarea";
}

/** Monaco language ids that ship a bundled tokenizer; JSON has none in the basic-languages set. */
const MONACO_LANGUAGE: Record<StudioSyntaxLanguage, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  json: "plaintext",
  markdown: "markdown",
  css: "css",
  html: "html",
  yaml: "yaml",
  sql: "sql",
  java: "java",
  csharp: "csharp",
  go: "go",
  rust: "rust",
  cpp: "cpp",
  plaintext: "plaintext",
};

export function monacoLanguageForStudio(language: StudioSyntaxLanguage): string {
  return MONACO_LANGUAGE[language];
}

/** Languages whose tokenizer definitions the Monaco loader bundles. */
export const STUDIO_MONACO_BUNDLED_LANGUAGES: readonly string[] = [
  ...new Set(Object.values(MONACO_LANGUAGE).filter((id) => id !== "plaintext")),
];
