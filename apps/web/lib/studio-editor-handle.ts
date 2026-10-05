/**
 * Editor-neutral control surface for the Studio code editor.
 *
 * Everything above the editor component (menus, find bar, shortcuts, edit
 * tracking) talks to the editor only through this interface. Offsets are
 * 0-based indices into the editor value; lines and columns are 1-based. None
 * of it assumes a DOM element, so another editor implementation can satisfy
 * the same contract.
 *
 * Gutter markers, multi-cursor and inline diagnostics are deliberately not
 * part of this contract yet: nothing consumes them through a handle today.
 */
export interface StudioEditorPosition {
  readonly line: number;
  readonly column: number;
}

export interface StudioEditorSelection {
  readonly start: number;
  readonly end: number;
}

export interface StudioEditorHandle {
  focus(): void;
  undo(): void;
  redo(): void;
  getValue(): string;
  /** Replaces the whole value through the editor's normal change path. */
  setValue(next: string): void;
  getCursor(): StudioEditorPosition;
  getSelection(): StudioEditorSelection;
  setSelection(start: number, end: number): void;
  /** Moves the cursor to the start of `line` and scrolls it into view. */
  revealLine(line: number): void;
  /** Selects the next match after the selection, wrapping once. Returns false when there is none. */
  findNext(needle: string): boolean;
}

/** Line height of the current editor surface, used for scroll maths. */
export const STUDIO_EDITOR_LINE_HEIGHT = 19.375;

/** Scroll offset that brings `line` (1-based) near the top, leaving `margin` px above it. */
export function studioEditorScrollTop(line: number, margin: number): number {
  return Math.max(0, (line - 1) * STUDIO_EDITOR_LINE_HEIGHT - margin);
}

/** Index of the next `needle` at or after `from`, wrapping to the start once; -1 when absent. */
export function findNextStudioMatch(text: string, needle: string, from: number): number {
  const at = text.indexOf(needle, from);
  return at < 0 ? text.indexOf(needle) : at;
}
