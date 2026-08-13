/**
 * S1.7 — Specialist defensive packs (Web · API · Cloud · Identity · DB · AI).
 * Heuristic evidence only — never offensive guidance.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";

export type SpecialistPackId =
  | "web"
  | "api"
  | "cloud"
  | "identity"
  | "db"
  | "ai-security";

export interface PackFinding {
  readonly id: string;
  readonly pack: SpecialistPackId;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly evidenceRefs: readonly string[];
  readonly claim: "INFERRED" | "OBSERVED";
  readonly epistemicState: "INFERRED" | "OBSERVED";
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
    if (st.isDirectory()) walk(full, root, out, limit);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|tf|md)$/i.test(name)) {
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= limit) return;
    }
  }
}

function sampleFiles(workspaceRoot: string): string[] {
  const analysis = analyzeRepository(workspaceRoot);
  const extras: string[] = [];
  walk(workspaceRoot, workspaceRoot, extras, 40);
  return [...new Set([...analysis.sampleFiles, ...extras])].slice(0, 120);
}

export function runSpecialistPacks(workspaceRoot: string): PackFinding[] {
  if (!existsSync(workspaceRoot)) return [];
  const files = sampleFiles(workspaceRoot);
  const findings: PackFinding[] = [];

  let sawDangerouslySetInnerHTML = false;
  let sawEval = false;
  let sawRawSql = false;
  let sawPromptConcat = false;
  let sawPublicBucket = false;
  let sawWeakJwt = false;
  let sawOpenRedirect = false;
  let sawIamStar = false;

  for (const rel of files) {
    const text = readTextFile(workspaceRoot, rel) ?? (() => {
      try {
        return readFileSync(join(workspaceRoot, rel), "utf8");
      } catch {
        return null;
      }
    })();
    if (!text || text.length > 400_000) continue;

    // Web
    if (/dangerouslySetInnerHTML/i.test(text)) {
      sawDangerouslySetInnerHTML = true;
      findings.push({
        id: `pack-web:xss-innerhtml:${rel}`,
        pack: "web",
        severity: "HIGH",
        title: `Potential XSS surface · dangerouslySetInnerHTML · ${rel}`,
        detail: "React dangerouslySetInnerHTML detected — treat as untrusted HTML risk.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:web", "pattern:dangerouslySetInnerHTML"],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation:
          "Sanitize/allowlist HTML · prefer text nodes · add CSP · regression test for XSS",
      });
    }
    if (/\beval\s*\(|new Function\s*\(/i.test(text)) {
      sawEval = true;
      findings.push({
        id: `pack-web:eval:${rel}`,
        pack: "web",
        severity: "CRITICAL",
        title: `Dynamic code execution · ${rel}`,
        detail: "eval/new Function detected — high code-injection risk.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:web", "pattern:eval"],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation: "Remove eval · use safe parsers · block in CSP",
      });
    }
    if (/window\.location\s*=|location\.href\s*=\s*[^'"`]/i.test(text) && /searchParams|query|req\.(query|body)/i.test(text)) {
      sawOpenRedirect = true;
      findings.push({
        id: `pack-web:open-redirect:${rel}`,
        pack: "web",
        severity: "MEDIUM",
        title: `Possible open redirect · ${rel}`,
        detail: "Location assignment near query/body input — verify allowlisted redirects.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:web", "pattern:open-redirect"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation: "Allowlist redirect targets · never bounce to raw user URLs",
      });
    }

    // API
    if (/\$\{[^}]+\}/.test(text) && /\b(query|sql|execute)\b/i.test(text) && /SELECT|INSERT|UPDATE|DELETE/i.test(text)) {
      sawRawSql = true;
      findings.push({
        id: `pack-api:sqli-risk:${rel}`,
        pack: "api",
        severity: "HIGH",
        title: `Possible string-built SQL · ${rel}`,
        detail: "SQL keywords with template interpolation — prefer parameterized queries.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:api", "pattern:sql-template"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation: "Use prepared statements / query builders · never concatenate user input into SQL",
      });
    }
    if (/\.query\([^)]*req\.(body|query|params)/i.test(text)) {
      findings.push({
        id: `pack-api:untrusted-query:${rel}`,
        pack: "api",
        severity: "MEDIUM",
        title: `Untrusted input reaches query helper · ${rel}`,
        detail: "Request body/query/params passed into query-like call.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:api", "pattern:req-to-query"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation: "Validate with zod · map to typed params · least privilege DB role",
      });
    }

    // Cloud
    if (/ACL\s*[:=]\s*['"]public-read['"]|public:\s*true|BlockPublicAcls\s*[:=]\s*false/i.test(text)) {
      sawPublicBucket = true;
      findings.push({
        id: `pack-cloud:public-storage:${rel}`,
        pack: "cloud",
        severity: "HIGH",
        title: `Public storage ACL signal · ${rel}`,
        detail: "Public-read / public bucket configuration detected.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:cloud", "pattern:public-acl"],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation: "Private by default · signed URLs · confirm intentional public assets only",
      });
    }
    if (/"Action"\s*:\s*"\*"|"Resource"\s*:\s*"\*"|Action\s*=\s*"\*"/i.test(text)) {
      sawIamStar = true;
      findings.push({
        id: `pack-cloud:iam-star:${rel}`,
        pack: "cloud",
        severity: "HIGH",
        title: `Over-broad IAM Action/Resource * · ${rel}`,
        detail: "Wildcard IAM permissions are a privilege-escalation hazard.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:cloud", "pattern:iam-star"],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation: "Least privilege · enumerate actions/resources · separate deploy vs runtime roles",
      });
    }

    // Identity
    if (/algorithms?\s*:\s*\[[^\]]*['"`]none['"`]|jwt\.decode\([^)]*\)\s*(?!.*verify)/i.test(text)) {
      sawWeakJwt = true;
      findings.push({
        id: `pack-identity:weak-jwt:${rel}`,
        pack: "identity",
        severity: "CRITICAL",
        title: `Weak JWT handling · ${rel}`,
        detail: "alg=none allowed or decode without verify pattern.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:identity", "pattern:weak-jwt"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation: "Verify signatures · pin algorithms · reject none",
      });
    }
    if (/password\s*===\s*|strcmp\s*\(\s*password/i.test(text) && !/bcrypt|argon2|scrypt|pbkdf2/i.test(text)) {
      findings.push({
        id: `pack-identity:plaintext-compare:${rel}`,
        pack: "identity",
        severity: "HIGH",
        title: `Possible plaintext password compare · ${rel}`,
        detail: "Password equality check without hashing library signal nearby.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:identity", "pattern:password-eq"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation: "Store hashes (argon2/bcrypt) · constant-time compare of hashes only",
      });
    }

    // DB
    if (/CREATE POLICY|ENABLE ROW LEVEL SECURITY|row level security/i.test(text)) {
      // positive signal — skip finding
    } else if (/supabase|postgres|prisma/i.test(text) && /service_role|SERVICE_ROLE|bypass.?rls/i.test(text)) {
      findings.push({
        id: `pack-db:service-role:${rel}`,
        pack: "db",
        severity: "HIGH",
        title: `Service-role / RLS bypass signal · ${rel}`,
        detail: "Service role can bypass RLS — ensure never exposed to browsers.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:db", "pattern:service-role"],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation: "Server-only service role · user JWT for client paths · audit dual-write",
      });
    }

    // AI-security
    if (
      /system\s*:\s*[`'"][\s\S]{0,200}\$\{|prompt\s*\+\s*|messages\.push\(\s*\{[^}]*content:\s*[^,}]*req\./i.test(
        text,
      )
    ) {
      sawPromptConcat = true;
      findings.push({
        id: `pack-ai:prompt-injection:${rel}`,
        pack: "ai-security",
        severity: "HIGH",
        title: `Prompt construction with untrusted input · ${rel}`,
        detail: "User/request content interpolated into prompts — injection risk.",
        path: rel,
        evidenceRefs: [`file:${rel}`, "pack:ai-security", "pattern:prompt-concat"],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation:
          "Treat user text as data · delimit clearly · tool allowlists · never follow untrusted instructions",
      });
    }
  }

  // Coverage notes when packs found nothing of a class — omit noise; only emit if critical patterns absent in high-risk stacks
  void sawDangerouslySetInnerHTML;
  void sawEval;
  void sawRawSql;
  void sawPromptConcat;
  void sawPublicBucket;
  void sawWeakJwt;
  void sawOpenRedirect;
  void sawIamStar;

  return findings.slice(0, 40);
}
