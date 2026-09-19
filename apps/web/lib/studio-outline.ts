export interface StudioOutlineSymbol {
  readonly kind: "function" | "class" | "type" | "route";
  readonly name: string;
  readonly line: number;
}

const PATTERNS: ReadonlyArray<{
  kind: StudioOutlineSymbol["kind"];
  re: RegExp;
  name: (match: RegExpExecArray) => string;
}> = [
  {
    kind: "function",
    re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)/g,
    name: (match) => match[1] ?? "",
  },
  {
    kind: "class",
    re: /(?:export\s+)?class\s+([A-Za-z_][\w]*)/g,
    name: (match) => match[1] ?? "",
  },
  {
    kind: "type",
    re: /(?:export\s+)?(?:type|interface)\s+([A-Za-z_][\w]*)/g,
    name: (match) => match[1] ?? "",
  },
  {
    kind: "route",
    re: /\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]+)["'`]/gi,
    name: (match) => `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`.trim(),
  },
];

/** Current-buffer outline. Not a language service and not type-aware. */
export function extractStudioOutline(content: string): StudioOutlineSymbol[] {
  const symbols: StudioOutlineSymbol[] = [];
  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      const name = pattern.name(match);
      if (!name) continue;
      const prefix = content.slice(0, match.index);
      const line = prefix.split("\n").length;
      symbols.push({ kind: pattern.kind, name, line });
    }
  }
  return symbols
    .sort((a, b) => a.line - b.line)
    .slice(0, 80);
}

export function studioFileBreadcrumbs(path: string): string[] {
  return path.split("/").filter(Boolean);
}
