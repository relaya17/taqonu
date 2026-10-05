import type * as Monaco from "monaco-editor/editor/editor.api";

/**
 * Local-only Monaco loader (client only).
 *
 * Imports a curated set of Monaco modules instead of `monaco-editor`'s full
 * entry point: the core editor, basic editing commands, and tokenizers for the
 * languages the Studio highlighter knows. It deliberately leaves out Monaco's
 * own find widget, suggestions, hover, context menu and its TypeScript / JSON /
 * CSS / HTML language-service workers: diagnostics and code tools come from the
 * Studio API, and the Studio find bar is the only find UI.
 *
 * Everything is bundled by webpack from node_modules; nothing is fetched from a
 * CDN at runtime.
 */
export type StudioMonaco = typeof Monaco;

let loading: Promise<StudioMonaco> | null = null;

export function loadStudioMonaco(): Promise<StudioMonaco> {
  if (!loading) {
    loading = (async () => {
      // Must exist before the first editor is created; only the base editor worker is needed.
      self.MonacoEnvironment = {
        getWorker: () =>
          new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url)),
      };
      const monaco = await import("monaco-editor/editor/editor.api");
      await Promise.all([
        import("monaco-editor/editor/browser/coreCommands"),
        import("monaco-editor/editor/contrib/clipboard/browser/clipboard"),
        import("monaco-editor/editor/contrib/wordOperations/browser/wordOperations"),
        import("monaco-editor/languages/definitions/typescript/register"),
        import("monaco-editor/languages/definitions/javascript/register"),
        import("monaco-editor/languages/definitions/python/register"),
        import("monaco-editor/languages/definitions/markdown/register"),
        import("monaco-editor/languages/definitions/css/register"),
        import("monaco-editor/languages/definitions/html/register"),
        import("monaco-editor/languages/definitions/yaml/register"),
        import("monaco-editor/languages/definitions/sql/register"),
        import("monaco-editor/languages/definitions/java/register"),
        import("monaco-editor/languages/definitions/csharp/register"),
        import("monaco-editor/languages/definitions/go/register"),
        import("monaco-editor/languages/definitions/rust/register"),
        import("monaco-editor/languages/definitions/cpp/register"),
      ]);
      return monaco;
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
