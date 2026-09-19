export type StudioSyntaxLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "json"
  | "markdown"
  | "css"
  | "html"
  | "yaml"
  | "sql"
  | "java"
  | "csharp"
  | "go"
  | "rust"
  | "cpp"
  | "plaintext";

export type StudioSyntaxTokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number";

export interface StudioSyntaxToken {
  readonly kind: StudioSyntaxTokenKind;
  readonly text: string;
}

const KEYWORDS: Record<Exclude<StudioSyntaxLanguage, "plaintext" | "markdown" | "json" | "yaml" | "html" | "css">, readonly string[]> =
  {
    typescript: [
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "else",
      "export",
      "extends",
      "false",
      "finally",
      "for",
      "function",
      "if",
      "import",
      "interface",
      "let",
      "new",
      "null",
      "return",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "type",
      "undefined",
      "void",
      "while",
    ],
    javascript: [
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "else",
      "export",
      "false",
      "finally",
      "for",
      "function",
      "if",
      "import",
      "let",
      "new",
      "null",
      "return",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "undefined",
      "void",
      "while",
    ],
    python: [
      "and",
      "class",
      "def",
      "elif",
      "else",
      "except",
      "False",
      "for",
      "from",
      "if",
      "import",
      "in",
      "None",
      "not",
      "or",
      "pass",
      "return",
      "True",
      "try",
      "while",
    ],
    sql: [
      "AND",
      "AS",
      "CREATE",
      "FROM",
      "INSERT",
      "INTO",
      "JOIN",
      "NOT",
      "NULL",
      "OR",
      "SELECT",
      "TABLE",
      "UPDATE",
      "WHERE",
    ],
    java: [
      "class",
      "else",
      "false",
      "final",
      "for",
      "if",
      "import",
      "new",
      "null",
      "public",
      "return",
      "static",
      "true",
      "void",
      "while",
    ],
    csharp: [
      "class",
      "else",
      "false",
      "for",
      "if",
      "namespace",
      "new",
      "null",
      "public",
      "return",
      "static",
      "true",
      "void",
      "while",
    ],
    go: [
      "else",
      "false",
      "for",
      "func",
      "if",
      "import",
      "nil",
      "package",
      "return",
      "true",
      "var",
    ],
    rust: [
      "else",
      "enum",
      "false",
      "fn",
      "for",
      "if",
      "impl",
      "let",
      "mod",
      "mut",
      "pub",
      "return",
      "struct",
      "true",
      "use",
    ],
    cpp: [
      "class",
      "else",
      "false",
      "for",
      "if",
      "namespace",
      "return",
      "true",
      "void",
      "while",
    ],
  };

/** Map API `languageHint` to a highlighter mode. Unknown hints stay plaintext. */
export function studioSyntaxLanguage(
  languageHint: string | null | undefined,
): StudioSyntaxLanguage {
  switch (languageHint) {
    case "typescript":
    case "javascript":
    case "python":
    case "json":
    case "markdown":
    case "css":
    case "html":
    case "yaml":
    case "sql":
    case "java":
    case "csharp":
    case "go":
    case "rust":
    case "cpp":
      return languageHint;
    default:
      return "plaintext";
  }
}

function pushPlain(tokens: StudioSyntaxToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.kind === "plain") {
    tokens[tokens.length - 1] = { kind: "plain", text: last.text + text };
    return;
  }
  tokens.push({ kind: "plain", text });
}

/**
 * Line-oriented highlighter. Not a language service — no type errors,
 * no diagnostics, no IntelliSense.
 */
export function highlightStudioLine(
  line: string,
  languageHint: string | null | undefined,
): readonly StudioSyntaxToken[] {
  const language = studioSyntaxLanguage(languageHint);
  if (language === "plaintext") {
    return line.length === 0 ? [] : [{ kind: "plain", text: line }];
  }

  if (
    language === "javascript" ||
    language === "typescript" ||
    language === "java" ||
    language === "csharp" ||
    language === "go" ||
    language === "rust" ||
    language === "cpp" ||
    language === "css"
  ) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return [{ kind: "comment", text: line }];
    }
  }
  if (language === "python" || language === "yaml") {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) return [{ kind: "comment", text: line }];
  }
  if (language === "sql") {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("--")) return [{ kind: "comment", text: line }];
  }
  if (language === "html" || language === "markdown") {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("<!--")) return [{ kind: "comment", text: line }];
  }

  const tokens: StudioSyntaxToken[] = [];
  const keywordSet = new Set(
    language in KEYWORDS
      ? KEYWORDS[language as keyof typeof KEYWORDS]
      : [],
  );
  const re =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b)/g;
  let last = 0;
  let match: RegExpExecArray | null = re.exec(line);
  while (match) {
    if (match.index > last) pushPlain(tokens, line.slice(last, match.index));
    const lexeme = match[0];
    if (lexeme.startsWith("\"") || lexeme.startsWith("'") || lexeme.startsWith("`")) {
      tokens.push({ kind: "string", text: lexeme });
    } else if (/^\d/.test(lexeme)) {
      tokens.push({ kind: "number", text: lexeme });
    } else if (keywordSet.has(lexeme)) {
      tokens.push({ kind: "keyword", text: lexeme });
    } else {
      pushPlain(tokens, lexeme);
    }
    last = match.index + lexeme.length;
    match = re.exec(line);
  }
  if (last < line.length) pushPlain(tokens, line.slice(last));
  return tokens.length > 0 ? tokens : [{ kind: "plain", text: line }];
}

export function studioLineCount(content: string): number {
  if (content.length === 0) return 1;
  return content.split("\n").length;
}

export function offsetForStudioLine(content: string, line: number): number {
  if (line <= 1) return 0;
  const parts = content.split("\n");
  const index = Math.min(Math.max(line, 1), parts.length) - 1;
  let offset = 0;
  for (let i = 0; i < index; i += 1) {
    offset += parts[i]!.length + 1;
  }
  return offset;
}
