import { describe, expect, it, vi } from "vitest";
import { delegateStudioEditorHandle, type StudioEditorHandle } from "./studio-editor-handle";
import {
  STUDIO_EDITOR_BACKEND_KEY,
  STUDIO_MONACO_BUNDLED_LANGUAGES,
  monacoLanguageForStudio,
  resolveStudioEditorBackend,
} from "./studio-editor-backend";
import { studioSyntaxLanguage } from "./studio-syntax";

describe("resolveStudioEditorBackend", () => {
  it("defaults to the textarea", () => {
    expect(resolveStudioEditorBackend({ stored: null, narrow: false })).toBe("textarea");
    expect(resolveStudioEditorBackend({ stored: "", narrow: false })).toBe("textarea");
    expect(resolveStudioEditorBackend({ stored: "nonsense", narrow: false })).toBe("textarea");
    expect(resolveStudioEditorBackend({ stored: "textarea", narrow: false })).toBe("textarea");
  });

  it("opts into Monaco only when stored and wide", () => {
    expect(resolveStudioEditorBackend({ stored: "monaco", narrow: false })).toBe("monaco");
  });

  it("keeps the textarea on narrow viewports even when Monaco is stored", () => {
    expect(resolveStudioEditorBackend({ stored: "monaco", narrow: true })).toBe("textarea");
  });

  it("uses the shared atlas.studio key namespace", () => {
    expect(STUDIO_EDITOR_BACKEND_KEY).toBe("atlas.studio.editorBackend");
  });
});

describe("monacoLanguageForStudio", () => {
  it("maps every language the studio highlighter can return", () => {
    for (const hint of [
      "typescript", "javascript", "python", "json", "markdown", "css", "html",
      "yaml", "sql", "java", "csharp", "go", "rust", "cpp", "plaintext", null, "unknown",
    ]) {
      expect(monacoLanguageForStudio(studioSyntaxLanguage(hint))).toEqual(expect.any(String));
    }
  });

  it("falls back to plaintext where Monaco has no bundled tokenizer", () => {
    expect(monacoLanguageForStudio("json")).toBe("plaintext");
    expect(monacoLanguageForStudio("plaintext")).toBe("plaintext");
  });

  it("lists each bundled tokenizer once and never plaintext", () => {
    expect(STUDIO_MONACO_BUNDLED_LANGUAGES).not.toContain("plaintext");
    expect(new Set(STUDIO_MONACO_BUNDLED_LANGUAGES).size).toBe(STUDIO_MONACO_BUNDLED_LANGUAGES.length);
    expect(STUDIO_MONACO_BUNDLED_LANGUAGES).toContain("typescript");
  });
});

describe("delegateStudioEditorHandle", () => {
  const stub = (): StudioEditorHandle => ({
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getValue: vi.fn(() => "abc"),
    setValue: vi.fn(),
    getCursor: vi.fn(() => ({ line: 4, column: 2 })),
    getSelection: vi.fn(() => ({ start: 1, end: 3 })),
    setSelection: vi.fn(),
    revealLine: vi.fn(),
    findNext: vi.fn(() => true),
  });

  it("forwards every method to the current backend", () => {
    const backend = stub();
    const handle = delegateStudioEditorHandle(() => backend);
    handle.focus();
    handle.undo();
    handle.redo();
    handle.setValue("x");
    handle.setSelection(1, 2);
    handle.revealLine(9);
    expect(handle.getValue()).toBe("abc");
    expect(handle.getCursor()).toEqual({ line: 4, column: 2 });
    expect(handle.getSelection()).toEqual({ start: 1, end: 3 });
    expect(handle.findNext("a")).toBe(true);
    expect(backend.setValue).toHaveBeenCalledWith("x");
    expect(backend.setSelection).toHaveBeenCalledWith(1, 2);
    expect(backend.revealLine).toHaveBeenCalledWith(9);
  });

  it("follows a backend swap through the same handle", () => {
    let current: StudioEditorHandle | null = stub();
    const handle = delegateStudioEditorHandle(() => current);
    const next = stub();
    vi.mocked(next.getValue).mockReturnValue("other");
    current = next;
    expect(handle.getValue()).toBe("other");
  });

  it("is inert, not throwing, when no backend is mounted", () => {
    const handle = delegateStudioEditorHandle(() => null);
    expect(() => {
      handle.focus();
      handle.undo();
      handle.redo();
      handle.setValue("x");
      handle.setSelection(0, 0);
      handle.revealLine(1);
    }).not.toThrow();
    expect(handle.getValue()).toBe("");
    expect(handle.getCursor()).toEqual({ line: 1, column: 1 });
    expect(handle.getSelection()).toEqual({ start: 0, end: 0 });
    expect(handle.findNext("a")).toBe(false);
  });
});
