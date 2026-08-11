const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "generic_api_key", pattern: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}/i },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "supabase_service_role",
    pattern: /\bservice[_-]?role[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9._\-]{20,}/i,
  },
  {
    name: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  },
  {
    name: "database_url_password",
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  },
];

export interface SecretFinding {
  readonly name: string;
  readonly index: number;
}

export function detectSecrets(text: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index !== undefined) {
      findings.push({ name, index: match.index });
    }
  }
  return findings;
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

export function assertNoSecrets(text: string, context: string): void {
  const findings = detectSecrets(text);
  if (findings.length > 0) {
    throw new Error(
      `Secret detected before ${context}: ${findings.map((f) => f.name).join(", ")}`,
    );
  }
}
