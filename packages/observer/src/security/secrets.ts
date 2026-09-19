/**
 * Atlas Sentinel — S1.1 Secret Detection (defensive only).
 * Finds likely secrets in linked workspace text files; never exfiltrates values.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
  ".temp",
  "test-results",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

export interface SecretFinding {
  readonly id: string;
  readonly kind: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly line: number;
  /** Redacted preview only — never full secret. */
  readonly redacted: string;
  readonly evidenceRefs: readonly string[];
  readonly claim: "OBSERVED";
  readonly epistemicState: "OBSERVED";
  readonly remediation: string;
}

const PATTERNS: ReadonlyArray<{
  readonly kind: string;
  readonly severity: SecretFinding["severity"];
  readonly re: RegExp;
  readonly title: string;
}> = [
  {
    kind: "aws_access_key",
    severity: "CRITICAL",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    title: "Possible AWS access key id",
  },
  {
    kind: "generic_api_key",
    severity: "HIGH",
    re: /\b(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"]{16,}['"]/gi,
    title: "Hard-coded API key assignment",
  },
  {
    kind: "bearer_token",
    severity: "HIGH",
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    title: "Bearer token literal",
  },
  {
    kind: "private_key",
    severity: "CRITICAL",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    title: "Private key material in repo",
  },
  {
    kind: "slack_token",
    severity: "HIGH",
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,
    title: "Possible Slack token",
  },
  {
    kind: "github_pat",
    severity: "CRITICAL",
    re: /\bghp_[A-Za-z0-9]{36}\b/g,
    title: "Possible GitHub personal access token",
  },
  {
    kind: "stripe_live",
    severity: "CRITICAL",
    re: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
    title: "Stripe live secret key",
  },
  {
    kind: "connection_string_password",
    severity: "HIGH",
    re: /\b(?:postgres|mysql|mongodb):\/\/[^:\s]+:[^@\s]+@/gi,
    title: "Database URL with embedded credentials",
  },
];

function redact(match: string): string {
  if (match.length <= 8) return "***";
  return `${match.slice(0, 4)}…${match.slice(-4)} (len=${match.length})`;
}

function walkFiles(
  dir: string,
  root: string,
  out: string[],
  limit: number,
  deadlineMs: number,
): void {
  if (out.length >= limit) return;
  if (Date.now() > deadlineMs) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (Date.now() > deadlineMs) return;
    if (SKIP.has(name) || name.startsWith("_tmp")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, root, out, limit, deadlineMs);
    } else if (
      /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|env|local|example|txt|pem|key)$/i.test(
        name,
      ) ||
      name.startsWith(".env")
    ) {
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= limit) return;
    }
  }
}

export function detectSecrets(
  workspaceRoot: string,
  options?: { readonly maxFiles?: number; readonly deadlineMs?: number },
): SecretFinding[] {
  if (!existsSync(workspaceRoot)) return [];
  const files: string[] = [];
  const deadlineMs = options?.deadlineMs ?? Number.POSITIVE_INFINITY;
  walkFiles(
    workspaceRoot,
    workspaceRoot,
    files,
    options?.maxFiles ?? 120,
    deadlineMs,
  );
  const findings: SecretFinding[] = [];

  for (const rel of files) {
    if (Date.now() > deadlineMs) break;
    const full = join(workspaceRoot, rel);
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.length > 400_000) continue;
    findings.push(...findSecretsInText(rel, text));
    if (findings.length >= 40) return findings.slice(0, 40);
  }

  return findings;
}

/** Scan a single file's text. Used by GET last-scan verify and remediation checks. */
export function findSecretsInText(
  rel: string,
  text: string,
): SecretFinding[] {
  if (text.length > 400_000) return [];
  const lines = text.split(/\r?\n/);
  const findings: SecretFinding[] = [];

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const before = text.slice(0, idx);
      const line = before.split(/\r?\n/).length;
      const sample = lines[line - 1] ?? m[0]!;
      if (/YOUR_|changeme|example|xxx+|placeholder|<.*>/i.test(sample)) {
        continue;
      }
      findings.push({
        id: `secret:${rel}:${pattern.kind}:${line}`,
        kind: pattern.kind,
        severity: pattern.severity,
        title: pattern.title,
        detail: `Potential secret in ${rel}:${line}. Value redacted.`,
        path: rel,
        line,
        redacted: redact(m[0]!),
        evidenceRefs: [
          `file:${rel}`,
          `line:${line}`,
          `kind:${pattern.kind}`,
          `redacted:${redact(m[0]!)}`,
        ],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation:
          "Rotate the credential immediately · remove from git history · use env/secret manager · add to .gitignore",
      });
      if (findings.length >= 40) return findings;
    }
  }

  return findings;
}

const ENV_FOR_KIND: Record<string, string> = {
  aws_access_key: "AWS_ACCESS_KEY_ID",
  github_pat: "GITHUB_TOKEN",
  stripe_live: "STRIPE_SECRET_KEY",
  slack_token: "SLACK_TOKEN",
  bearer_token: "API_BEARER_TOKEN",
  generic_api_key: "API_KEY",
  connection_string_password: "DATABASE_URL",
  private_key: "PRIVATE_KEY",
};

/**
 * Replace quoted secret literals with env reads.
 * Returns the rewritten text; caller must re-scan before claiming a fix.
 */
export function replaceQuotedSecretLiterals(text: string): string {
  let next = text;
  for (const pattern of PATTERNS) {
    const env = ENV_FOR_KIND[pattern.kind] ?? "SECRET";
    const quoted = new RegExp(
      `(['"\`])(${pattern.re.source})\\1`,
      pattern.re.flags.includes("g") ? pattern.re.flags : `${pattern.re.flags}g`,
    );
    next = next.replace(quoted, `process.env.${env} ?? ""`);
  }
  return next;
}
