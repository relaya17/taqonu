/**
 * Type-aware Studio language intelligence using TypeScript's language service.
 * Not regex parsing. Not an LLM. Workspace-bounded; skips secrets and node_modules.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  isWorkspaceSecretFile,
  resolveUnderWorkspace,
  WORKSPACE_SKIP_DIRS,
} from "./workspace-browser.js";

const TS_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
const MAX_LS_FILES = 80;
const MAX_LS_FILE_BYTES = 200_000;
const MAX_DEPTH = 12;

export interface StudioLsDiagnostic {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: "error" | "warning" | "info";
  readonly code: number;
  readonly message: string;
}

export interface StudioLsLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export interface StudioLsHover {
  readonly display: string;
  readonly documentation: string;
}

export interface StudioLsSymbol {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
}

export interface StudioLsEdit {
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly newText: string;
}

export interface StudioLsUnsaved {
  readonly path: string;
  readonly content: string;
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

function normalizeRel(path: string): string {
  return toPosix(path).replace(/^\/+/, "");
}

function collectScripts(workspaceRoot: string): { root: string; files: Map<string, string> } {
  const root = resolve(workspaceRoot);
  const files = new Map<string, string>();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`workspaceRoot not found: ${root}`);
  }

  function walk(dir: string, depth: number): void {
    if (files.size >= MAX_LS_FILES || depth > MAX_DEPTH) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (files.size >= MAX_LS_FILES) return;
      if (WORKSPACE_SKIP_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".env.example") continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile() || !TS_EXT.test(name)) continue;
      const rel = toPosix(relative(root, full));
      if (isWorkspaceSecretFile(rel)) continue;
      if (st.size > MAX_LS_FILE_BYTES) continue;
      files.set(rel, readFileSync(full, "utf8"));
    }
  }

  walk(root, 0);
  return { root, files };
}

function abs(root: string, rel: string): string {
  return resolve(root, rel.split("/").join(sep));
}

function relOf(root: string, fileName: string): string {
  return toPosix(relative(root, fileName));
}

function offsetOf(content: string, line: number, column: number): number {
  const lines = content.split("\n");
  const row = Math.max(0, line - 1);
  if (row >= lines.length) return content.length;
  const col = Math.max(0, column - 1);
  let offset = 0;
  for (let i = 0; i < row; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + Math.min(col, lines[row]?.length ?? 0);
}

function positionOf(content: string, offset: number): { line: number; column: number } {
  const sliced = content.slice(0, Math.max(0, offset));
  const lines = sliced.split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

function createService(
  workspaceRoot: string,
  unsaved?: StudioLsUnsaved,
): {
  root: string;
  files: Map<string, string>;
  service: ts.LanguageService;
  dispose: () => void;
} {
  const collected = collectScripts(workspaceRoot);
  if (unsaved?.path) {
    collected.files.set(normalizeRel(unsaved.path), unsaved.content);
  }
  const { root, files } = collected;
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.es2022.d.ts"],
  };
  const scriptNames = [...files.keys()].map((rel) => abs(root, rel));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => scriptNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const rel = relOf(root, fileName);
      const content = files.get(rel);
      if (content === undefined) return undefined;
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    root,
    files,
    service,
    dispose: () => service.dispose(),
  };
}

function mapDiagnostic(
  root: string,
  files: Map<string, string>,
  diagnostic: ts.Diagnostic,
): StudioLsDiagnostic | null {
  if (!diagnostic.file) return null;
  const path = relOf(root, diagnostic.file.fileName);
  if (!files.has(path)) return null;
  const content = files.get(path) ?? "";
  const start = diagnostic.start ?? 0;
  const end = start + (diagnostic.length ?? 0);
  const from = positionOf(content, start);
  const to = positionOf(content, end);
  const category =
    diagnostic.category === ts.DiagnosticCategory.Error
      ? "error"
      : diagnostic.category === ts.DiagnosticCategory.Warning
        ? "warning"
        : "info";
  return {
    path,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
    severity: category,
    code: typeof diagnostic.code === "number" ? diagnostic.code : 0,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

function withFile<T>(
  workspaceRoot: string,
  path: string,
  unsaved: StudioLsUnsaved | undefined,
  run: (input: {
    root: string;
    files: Map<string, string>;
    service: ts.LanguageService;
    rel: string;
    fileName: string;
    content: string;
  }) => T,
): T {
  const rel = normalizeRel(path);
  resolveUnderWorkspace(workspaceRoot, rel);
  const { root, files, service, dispose } = createService(workspaceRoot, unsaved);
  try {
    const content = files.get(rel);
    if (content === undefined) {
      throw new Error(`File not in language service: ${rel}`);
    }
    return run({
      root,
      files,
      service,
      rel,
      fileName: abs(root, rel),
      content,
    });
  } finally {
    dispose();
  }
}

export function studioLanguageDiagnostics(
  workspaceRoot: string,
  path: string,
  unsaved?: StudioLsUnsaved,
): readonly StudioLsDiagnostic[] {
  try {
    return withFile(workspaceRoot, path, unsaved, ({ root, files, service, fileName }) => {
      const diags = [
        ...service.getSyntacticDiagnostics(fileName),
        ...service.getSemanticDiagnostics(fileName),
      ];
      return diags
        .map((diagnostic) => mapDiagnostic(root, files, diagnostic))
        .filter((row): row is StudioLsDiagnostic => row !== null);
    });
  } catch (error) {
    if (error instanceof Error && /not in language service/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

export function studioLanguageHover(
  workspaceRoot: string,
  path: string,
  line: number,
  column: number,
  unsaved?: StudioLsUnsaved,
): StudioLsHover | null {
  return withFile(workspaceRoot, path, unsaved, ({ service, fileName, content }) => {
    const info = service.getQuickInfoAtPosition(fileName, offsetOf(content, line, column));
    if (!info) return null;
    return {
      display: ts.displayPartsToString(info.displayParts),
      documentation: ts.displayPartsToString(info.documentation),
    };
  });
}

export function studioLanguageDefinition(
  workspaceRoot: string,
  path: string,
  line: number,
  column: number,
  unsaved?: StudioLsUnsaved,
): StudioLsLocation | null {
  return withFile(workspaceRoot, path, unsaved, ({ root, files, service, fileName, content }) => {
    const defs = service.getDefinitionAtPosition(fileName, offsetOf(content, line, column));
    const first = defs?.[0];
    if (!first) return null;
    const targetRel = relOf(root, first.fileName);
    if (!files.has(targetRel)) return null;
    const target = files.get(targetRel) ?? "";
    const pos = positionOf(target, first.textSpan.start);
    return { path: targetRel, line: pos.line, column: pos.column };
  });
}

export function studioLanguageReferences(
  workspaceRoot: string,
  path: string,
  line: number,
  column: number,
  unsaved?: StudioLsUnsaved,
): readonly StudioLsLocation[] {
  return withFile(workspaceRoot, path, unsaved, ({ root, files, service, fileName, content }) => {
    const refs = service.getReferencesAtPosition(fileName, offsetOf(content, line, column));
    if (!refs) return [];
    const out: StudioLsLocation[] = [];
    const entries: Array<{ fileName: string; textSpan: ts.TextSpan }> = [];
    for (const group of refs) {
      const nested = (group as { references?: typeof refs }).references;
      if (Array.isArray(nested)) {
        for (const ref of nested) entries.push(ref);
      } else if (group.textSpan && group.fileName) {
        entries.push(group);
      }
    }
    for (const ref of entries) {
      const targetRel = relOf(root, ref.fileName);
      if (!files.has(targetRel)) continue;
      const target = files.get(targetRel) ?? "";
      const pos = positionOf(target, ref.textSpan.start);
      out.push({ path: targetRel, line: pos.line, column: pos.column });
    }
    return out.slice(0, 40);
  });
}

export function studioLanguageRename(
  workspaceRoot: string,
  path: string,
  line: number,
  column: number,
  newName: string,
  unsaved?: StudioLsUnsaved,
): readonly StudioLsEdit[] {
  const next = newName.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(next)) {
    throw new Error("Rename target must be a TypeScript identifier.");
  }
  return withFile(workspaceRoot, path, unsaved, ({ root, files, service, fileName, content }) => {
    const locations = service.findRenameLocations(
      fileName,
      offsetOf(content, line, column),
      false,
      false,
    );
    if (!locations) return [];
    const edits: StudioLsEdit[] = [];
    for (const loc of locations) {
      const targetRel = relOf(root, loc.fileName);
      if (!files.has(targetRel)) continue;
      const target = files.get(targetRel) ?? "";
      const start = positionOf(target, loc.textSpan.start);
      const end = positionOf(target, loc.textSpan.start + loc.textSpan.length);
      edits.push({
        path: targetRel,
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
        newText: next,
      });
    }
    return edits;
  });
}

function flattenNav(
  items: readonly ts.NavigationBarItem[],
  content: string,
  acc: StudioLsSymbol[],
): void {
  for (const item of items) {
    const span = item.spans[0];
    if (span) {
      const pos = positionOf(content, span.start);
      acc.push({
        name: item.text,
        kind: String(item.kind),
        line: pos.line,
      });
    }
    if (item.childItems?.length) flattenNav(item.childItems, content, acc);
  }
}

export function studioLanguageSymbols(
  workspaceRoot: string,
  path: string,
  unsaved?: StudioLsUnsaved,
): readonly StudioLsSymbol[] {
  try {
    return withFile(workspaceRoot, path, unsaved, ({ service, fileName, content }) => {
      const items = service.getNavigationBarItems(fileName);
      const symbols: StudioLsSymbol[] = [];
      flattenNav(items, content, symbols);
      return symbols.slice(0, 80);
    });
  } catch (error) {
    if (error instanceof Error && /not in language service/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

export function applyStudioLanguageEdits(
  content: string,
  edits: readonly StudioLsEdit[],
  path: string,
): string {
  const mine = edits
    .filter((edit) => edit.path === path)
    .slice()
    .sort((a, b) => {
      if (a.startLine !== b.startLine) return b.startLine - a.startLine;
      return b.startColumn - a.startColumn;
    });
  let next = content;
  for (const edit of mine) {
    const start = offsetOf(next, edit.startLine, edit.startColumn);
    const end = offsetOf(next, edit.endLine, edit.endColumn);
    next = next.slice(0, start) + edit.newText + next.slice(end);
  }
  return next;
}
