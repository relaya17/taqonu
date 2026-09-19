/**
 * In-buffer find/replace. Does not write disk. Empty find is a no-op.
 */
export function replaceInStudioBuffer(
  content: string,
  find: string,
  replacement: string,
  mode: "one" | "all",
): { next: string; count: number } {
  if (!find) return { next: content, count: 0 };
  if (mode === "one") {
    const index = content.indexOf(find);
    if (index < 0) return { next: content, count: 0 };
    return {
      next: content.slice(0, index) + replacement + content.slice(index + find.length),
      count: 1,
    };
  }
  if (!content.includes(find)) return { next: content, count: 0 };
  const parts = content.split(find);
  return { next: parts.join(replacement), count: parts.length - 1 };
}
