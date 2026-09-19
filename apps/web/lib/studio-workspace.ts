export const STUDIO_MAX_OPEN_FILES = 8;

export interface StudioFileBuffer {
  draft: string;
  saved: string;
}

export function addOpenStudioFile(
  open: readonly string[],
  path: string,
): string[] {
  const normalized = path.trim();
  if (!normalized) return [...open];
  if (open.includes(normalized)) return [...open];
  const next = [...open, normalized];
  if (next.length <= STUDIO_MAX_OPEN_FILES) return next;
  return next.slice(next.length - STUDIO_MAX_OPEN_FILES);
}

export function closeOpenStudioFile(
  open: readonly string[],
  path: string,
): { open: string[]; nextActive: string | null } {
  const remaining = open.filter((item) => item !== path);
  const idx = open.indexOf(path);
  const nextActive =
    remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? null;
  return { open: remaining, nextActive };
}

export function studioBufferIsDirty(
  buffer: StudioFileBuffer | undefined,
): boolean {
  return Boolean(buffer && buffer.draft !== buffer.saved);
}

export function anyStudioBufferDirty(
  buffers: Readonly<Record<string, StudioFileBuffer>>,
): boolean {
  return Object.values(buffers).some((buffer) => buffer.draft !== buffer.saved);
}

export function studioFileBaseName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Apply disk content without clobbering an unsaved draft.
 * When the user has local edits and the saved snapshot differs from disk,
 * keep the draft and treat the new disk bytes as the saved baseline.
 */
export function mergeStudioFileFromDisk(
  buffers: Readonly<Record<string, StudioFileBuffer>>,
  path: string,
  content: string,
): { buffers: Record<string, StudioFileBuffer>; diskChangedWhileDirty: boolean } {
  const existing = buffers[path];
  if (!existing) {
    return {
      buffers: { ...buffers, [path]: { draft: content, saved: content } },
      diskChangedWhileDirty: false,
    };
  }
  if (existing.draft !== existing.saved) {
    return {
      buffers: { ...buffers, [path]: { draft: existing.draft, saved: content } },
      diskChangedWhileDirty: existing.saved !== content,
    };
  }
  return {
    buffers: { ...buffers, [path]: { draft: content, saved: content } },
    diskChangedWhileDirty: false,
  };
}

export function markStudioFileSaved(
  buffers: Readonly<Record<string, StudioFileBuffer>>,
  path: string,
): Record<string, StudioFileBuffer> {
  const existing = buffers[path];
  if (!existing) return { ...buffers };
  return { ...buffers, [path]: { draft: existing.draft, saved: existing.draft } };
}
