/**
 * Allowlisted defensive advisories (upgrade-only). Not an exploit catalog.
 * Keep in sync with Admin Oracle A1.5 matching intent.
 */
export interface DefensiveAdvisory {
  readonly id: string;
  readonly packageName: string;
  readonly vulnerableBelow: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly sourceUrl: string;
}

export const DEFENSIVE_ADVISORIES: readonly DefensiveAdvisory[] = [
  {
    id: "GHSA-c2qf-rxjj-qqgw",
    packageName: "semver",
    vulnerableBelow: "7.5.2",
    severity: "HIGH",
    title: "semver ReDoS (historical)",
    sourceUrl: "https://github.com/advisories/GHSA-c2qf-rxjj-qqgw",
  },
  {
    id: "GHSA-hrpp-h998-j3pp",
    packageName: "word-wrap",
    vulnerableBelow: "1.2.4",
    severity: "MEDIUM",
    title: "word-wrap ReDoS (historical)",
    sourceUrl: "https://github.com/advisories/GHSA-hrpp-h998-j3pp",
  },
  {
    id: "CVE-2024-37890",
    packageName: "ws",
    vulnerableBelow: "8.17.1",
    severity: "HIGH",
    title: "ws DoS via many HTTP headers",
    sourceUrl: "https://nvd.nist.gov/vuln/detail/CVE-2024-37890",
  },
  {
    id: "GHSA-9wv6-86v2-598j",
    packageName: "braces",
    vulnerableBelow: "3.0.3",
    severity: "HIGH",
    title: "braces Uncontrolled resource consumption",
    sourceUrl: "https://github.com/advisories/GHSA-9wv6-86v2-598j",
  },
  {
    id: "GHSA-3xgq-45r0-rmwg",
    packageName: "cross-spawn",
    vulnerableBelow: "7.0.5",
    severity: "HIGH",
    title: "cross-spawn Regular Expression DoS",
    sourceUrl: "https://github.com/advisories/GHSA-3xgq-45r0-rmwg",
  },
  {
    id: "GHSA-c7qv-q95q-8v27",
    packageName: "micromatch",
    vulnerableBelow: "4.0.8",
    severity: "HIGH",
    title: "micromatch Regular Expression DoS",
    sourceUrl: "https://github.com/advisories/GHSA-c7qv-q95q-8v27",
  },
  {
    id: "GHSA-grv7-fg5c-xmjg",
    packageName: "tough-cookie",
    vulnerableBelow: "4.1.3",
    severity: "MEDIUM",
    title: "tough-cookie Prototype Pollution",
    sourceUrl: "https://github.com/advisories/GHSA-grv7-fg5c-xmjg",
  },
  {
    id: "GHSA-78xj-cgh5-2h22",
    packageName: "ip",
    vulnerableBelow: "2.0.1",
    severity: "HIGH",
    title: "ip SSRF via improper categorization",
    sourceUrl: "https://github.com/advisories/GHSA-78xj-cgh5-2h22",
  },
  {
    id: "GHSA-rv95-896h-c2vc",
    packageName: "cookie",
    vulnerableBelow: "0.7.0",
    severity: "MEDIUM",
    title: "cookie out of bounds characters",
    sourceUrl: "https://github.com/advisories/GHSA-rv95-896h-c2vc",
  },
  {
    id: "GHSA-w5m3-35g3-qr7w",
    packageName: "path-to-regexp",
    vulnerableBelow: "0.1.12",
    severity: "HIGH",
    title: "path-to-regexp Backtracking ReDoS",
    sourceUrl: "https://github.com/advisories/GHSA-w5m3-35g3-qr7w",
  },
];

function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.replace(/^[^0-9]*/, "").split("-")[0] ?? "";
  const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length < 1 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** true if installed < below (vulnerable). */
export function isVersionBelow(installed: string, below: string): boolean {
  const a = parseSemver(installed);
  const b = parseSemver(below);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return true;
    if (a[i]! > b[i]!) return false;
  }
  return false;
}
