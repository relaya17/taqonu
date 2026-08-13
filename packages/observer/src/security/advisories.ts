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
