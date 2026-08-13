/**
 * Atlas Sentinel — S1.4 Configuration security heuristics (defensive).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface ConfigFinding {
  readonly id: string;
  readonly kind: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly line: number;
  readonly evidenceRefs: readonly string[];
  readonly claim: "INFERRED";
  readonly epistemicState: "INFERRED";
  readonly remediation: string;
}

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
]);

const RULES: ReadonlyArray<{
  readonly kind: string;
  readonly severity: ConfigFinding["severity"];
  readonly re: RegExp;
  readonly title: string;
  readonly remediation: string;
}> = [
  {
    kind: "cors_star",
    severity: "HIGH",
    re: /Access-Control-Allow-Origin['"`:\s]*\*|(?:origin|cors)\s*:\s*(?:true|['"`]\*['"`])/gi,
    title: "Permissive CORS (* / origin:true)",
    remediation:
      "Restrict Allow-Origin to known fronts · avoid credentials+* · document intentional public APIs",
  },
  {
    kind: "tls_reject_disabled",
    severity: "CRITICAL",
    re: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/g,
    title: "TLS certificate verification disabled",
    remediation: "Remove NODE_TLS_REJECT_UNAUTHORIZED=0 · fix cert trust properly",
  },
  {
    kind: "cookie_insecure",
    severity: "HIGH",
    re: /(?:secure\s*:\s*false|sameSite\s*:\s*['"`]?none['"`]?)/gi,
    title: "Insecure cookie flags (secure:false / SameSite=None)",
    remediation:
      "Use Secure + HttpOnly + SameSite=Lax/Strict unless cross-site cookie is required with HTTPS",
  },
  {
    kind: "jwt_alg_none",
    severity: "CRITICAL",
    re: /algorithms?\s*:\s*\[[^\]]*['"`]none['"`]/gi,
    title: "JWT algorithm none allowed",
    remediation: "Disallow alg=none · pin allowed algorithms (e.g. RS256/HS256)",
  },
  {
    kind: "missing_helmet_hint",
    severity: "MEDIUM",
    re: /\b(?:express|fastify)\s*\(/g,
    title: "HTTP framework without nearby security headers hint",
    remediation:
      "Add helmet / @fastify/helmet · set CSP/HSTS where appropriate · verify in staging",
  },
];

function walk(dir: string, root: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, root, out, limit);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(name)) {
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= limit) return;
    }
  }
}

export function detectConfigSecurity(
  workspaceRoot: string,
): ConfigFinding[] {
  if (!existsSync(workspaceRoot)) return [];
  const files: string[] = [];
  walk(workspaceRoot, workspaceRoot, files, 100);
  const findings: ConfigFinding[] = [];
  let sawFramework = false;
  let sawHelmet = false;

  for (const rel of files) {
    const full = join(workspaceRoot, rel);
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.length > 400_000) continue;
    if (/\bhelmet\b|@fastify\/helmet|setHeader\(\s*['"]Content-Security-Policy/i.test(text)) {
      sawHelmet = true;
    }
    if (/\b(?:express|fastify)\s*\(/.test(text)) {
      sawFramework = true;
    }

    for (const rule of RULES) {
      if (rule.kind === "missing_helmet_hint") continue;
      const re = new RegExp(rule.re.source, rule.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split(/\r?\n/).length;
        findings.push({
          id: `config:${rel}:${rule.kind}:${line}`,
          kind: rule.kind,
          severity: rule.severity,
          title: rule.title,
          detail: `Config heuristic match in ${rel}:${line}.`,
          path: rel,
          line,
          evidenceRefs: [
            `file:${rel}`,
            `line:${line}`,
            `kind:${rule.kind}`,
            `match:${m[0]!.slice(0, 80)}`,
          ],
          claim: "INFERRED",
          epistemicState: "INFERRED",
          remediation: rule.remediation,
        });
        if (findings.length >= 30) return findings;
      }
    }
  }

  if (sawFramework && !sawHelmet) {
    findings.push({
      id: "config:missing-security-headers",
      kind: "missing_helmet_hint",
      severity: "MEDIUM",
      title: "HTTP app without detected security-headers middleware",
      detail:
        "Express/Fastify usage found but no helmet / CSP header helper in sampled files.",
      path: ".",
      line: 0,
      evidenceRefs: [
        "pattern:framework-without-helmet",
        "note:heuristic-sample",
      ],
      claim: "INFERRED",
      epistemicState: "INFERRED",
      remediation:
        "Add helmet / @fastify/helmet · set CSP/HSTS where appropriate · verify in staging",
    });
  }

  return findings;
}
