/**
 * Admin Oracle (TRUTH-10 · A1) — command persona + allowlisted brief shell.
 * No open-web scrape; defensive intel stubs cite allowlisted families only.
 */

export interface OracleAllowlistSource {
  readonly id: string;
  readonly title: string;
  readonly family: "internal" | "cve" | "vendor" | "law" | "release";
  readonly url: string;
  readonly note: string;
}

export interface OracleBriefItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly epistemicState: "OBSERVED" | "INFERRED" | "PROPOSED" | "UNKNOWN";
  readonly sourceId: string;
  readonly actionHint: string;
}

export interface AdminOracleShell {
  readonly codename: "Admin Oracle";
  readonly role: string;
  readonly mission: string;
  readonly gates: readonly string[];
  readonly roadmap: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "OPEN" | "PARTIAL" | "DONE";
  }[];
  readonly allowlist: readonly OracleAllowlistSource[];
  readonly dailyBrief: {
    readonly date: string;
    readonly headline: string;
    readonly items: readonly OracleBriefItem[];
    readonly note: string;
  };
  readonly surfaces: {
    readonly commandCenter: string;
    readonly truth: string;
    readonly patches: string;
    readonly verifiedSources: string;
  };
}

const ALLOWLIST: readonly OracleAllowlistSource[] = [
  {
    id: "atlas-truth",
    title: "Atlas Truth / Observer",
    family: "internal",
    url: "/he/truth",
    note: "Internal engineering truth loop — Change → Impact → Evidence → Risk → Verification",
  },
  {
    id: "nvd",
    title: "NVD / CVE",
    family: "cve",
    url: "https://nvd.nist.gov/",
    note: "Authorized vulnerability catalog — defensive matching to deps only",
  },
  {
    id: "cisa",
    title: "CISA advisories",
    family: "cve",
    url: "https://www.cisa.gov/news-events/cybersecurity-advisories",
    note: "Public CISA advisories — defensive alerting only",
  },
  {
    id: "nodejs-releases",
    title: "Node.js releases",
    family: "release",
    url: "https://nodejs.org/en/about/previous-releases",
    note: "Official runtime release / EOL signals",
  },
  {
    id: "next-releases",
    title: "Next.js releases",
    family: "vendor",
    url: "https://github.com/vercel/next.js/releases",
    note: "Official framework release notes",
  },
];

export function buildAdminOracleShell(input?: {
  readonly locale?: string;
}): AdminOracleShell {
  const locale = input?.locale === "en" ? "en" : "he";
  const date = new Date().toISOString().slice(0, 10);
  return {
    codename: "Admin Oracle",
    role: "Command agent for the premium admin console",
    mission:
      "Detect instability, bugs, version risk, deploy failures, and defensive cyber signals — then notify or propose fixes with evidence. Never train across tenants. Never offensive tooling.",
    gates: [
      "No evidence = no strong claim",
      "HIGH/CRITICAL require human approve before apply",
      "Allowlisted sources only for external intel",
      "Defensive cyber only (CVE/vendor/law) — no unauthorized scanning or offense",
    ],
    roadmap: [
      { id: "A1.1", title: "Admin Command Center shell", status: "PARTIAL" },
      { id: "A1.2", title: "Agent action queue (detect→rank→notify/propose)", status: "PARTIAL" },
      { id: "A1.3", title: "Version instability detector", status: "OPEN" },
      { id: "A1.4", title: "Daily hi-tech / advisory brief", status: "OPEN" },
      { id: "A1.5", title: "Defensive cyber feed → Graph", status: "OPEN" },
      { id: "A1.6", title: "Automation audit trail", status: "OPEN" },
      { id: "A1.7", title: "Morning digest Top-3 actions", status: "OPEN" },
    ],
    allowlist: ALLOWLIST,
    dailyBrief: {
      date,
      headline: "Oracle morning shell — live ingest lands in A1.4",
      items: [
        {
          id: "brief-truth",
          title: "Run Truth observe on linked workspaces",
          detail:
            "Behavioral drift + deploy nodes are the primary internal signal path today.",
          epistemicState: "OBSERVED",
          sourceId: "atlas-truth",
          actionHint: "Open /truth · Run observe cycle",
        },
        {
          id: "brief-cve",
          title: "Watch NVD/CISA for stack CVEs (manual until A1.5)",
          detail:
            "Allowlisted defensive sources are ready; automated CVE↔deps matching is not enabled yet.",
          epistemicState: "PROPOSED",
          sourceId: "nvd",
          actionHint: "Review allowlist · wait for A1.5 automation",
        },
        {
          id: "brief-versions",
          title: "Track Node/Next release + EOL notes",
          detail:
            "Unstable/EOL runtimes will feed A1.3 version instability detector.",
          epistemicState: "INFERRED",
          sourceId: "nodejs-releases",
          actionHint: "Compare local engines to official releases",
        },
      ],
      note: "Brief items are scaffolded. Daily automated ingest = A1.4.",
    },
    surfaces: {
      commandCenter: "/admin",
      truth: `/${locale}/truth`,
      patches: `/${locale}/patches`,
      verifiedSources: "/api/v1/knowledge/verified-sources",
    },
  };
}
