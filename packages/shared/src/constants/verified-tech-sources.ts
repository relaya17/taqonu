/**
 * Verified / authorized tech knowledge allow-list for agents.
 * Only official vendor docs, standards bodies, government cyber guidance,
 * and university CS portals — no blogs, forums, or invented citations.
 *
 * Agents must cite these URLs (or refuse with INSUFFICIENT_EVIDENCE).
 * Atlas does not scrape full curricula; it points specialists at primary sources.
 */

export const TECH_SOURCE_KINDS = [
  "OFFICIAL_VENDOR_DOCS",
  "GOVERNMENT_OR_STANDARDS",
  "SECURITY_ADVISORY",
  "UNIVERSITY",
] as const;

export type TechSourceKind = (typeof TECH_SOURCE_KINDS)[number];

export const TECH_SOURCE_DOMAINS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "cpp",
  "csharp",
  "go",
  "rust",
  "web_ui",
  "game_dev",
  "cybersecurity",
  "databases",
  "systems",
] as const;

export type TechSourceDomain = (typeof TECH_SOURCE_DOMAINS)[number];

export interface VerifiedTechSource {
  readonly id: string;
  readonly kind: TechSourceKind;
  readonly domain: TechSourceDomain;
  readonly titleEn: string;
  readonly titleHe: string;
  readonly url: string;
  /** Keywords that help hybrid retrieval match language / topic queries. */
  readonly topics: readonly string[];
  /** Short, honest summary — not a substitute for reading the primary source. */
  readonly excerptEn: string;
}

/**
 * Curated allow-list. Expand carefully; prefer docs.* / .gov / standards / .edu.
 * Last reviewed: 2026-08.
 */
export const VERIFIED_TECH_SOURCES: readonly VerifiedTechSource[] = [
  // —— JavaScript / ECMAScript / Web ——
  {
    id: "mdn-js",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "javascript",
    titleEn: "MDN — JavaScript reference",
    titleHe: "MDN — מדריך JavaScript",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    topics: ["javascript", "js", "ecmascript", "web", "browser", "dom"],
    excerptEn:
      "Mozilla Developer Network JavaScript language reference and guides. Primary web-platform documentation.",
  },
  {
    id: "mdn-web-api",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "javascript",
    titleEn: "MDN — Web APIs",
    titleHe: "MDN — ממשקי Web API",
    url: "https://developer.mozilla.org/en-US/docs/Web/API",
    topics: ["webapi", "dom", "fetch", "workers", "javascript"],
    excerptEn:
      "Official Web API reference on MDN (DOM, Fetch, Workers, and related browser interfaces).",
  },
  {
    id: "tc39-ecma262",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "javascript",
    titleEn: "ECMAScript Language Specification (TC39)",
    titleHe: "מפרט שפת ECMAScript (TC39)",
    url: "https://tc39.es/ecma262/",
    topics: ["ecmascript", "javascript", "tc39", "standard", "specification"],
    excerptEn:
      "Living ECMA-262 language specification maintained by TC39 — normative JavaScript semantics.",
  },
  {
    id: "nodejs-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "javascript",
    titleEn: "Node.js documentation",
    titleHe: "תיעוד Node.js",
    url: "https://nodejs.org/docs/latest/api/",
    topics: ["nodejs", "javascript", "server", "npm", "runtime"],
    excerptEn:
      "Official Node.js API documentation for the JavaScript server runtime.",
  },
  {
    id: "react-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "javascript",
    titleEn: "React documentation",
    titleHe: "תיעוד React",
    url: "https://react.dev/reference/react",
    topics: ["react", "javascript", "ui", "hooks", "jsx"],
    excerptEn:
      "Official React reference — components, hooks, and the React programming model.",
  },
  {
    id: "nextjs-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "javascript",
    titleEn: "Next.js documentation",
    titleHe: "תיעוד Next.js",
    url: "https://nextjs.org/docs",
    topics: ["nextjs", "react", "app-router", "javascript", "web"],
    excerptEn:
      "Official Next.js documentation — App Router, routing, and production web apps.",
  },

  // —— TypeScript ——
  {
    id: "typescript-handbook",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "typescript",
    titleEn: "TypeScript Handbook",
    titleHe: "מדריך TypeScript",
    url: "https://www.typescriptlang.org/docs/handbook/intro.html",
    topics: ["typescript", "ts", "types", "javascript", "static-typing"],
    excerptEn:
      "Official TypeScript Handbook from Microsoft / typescriptlang.org — typed JavaScript.",
  },
  {
    id: "typescript-reference",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "typescript",
    titleEn: "TypeScript — Declaration & config reference",
    titleHe: "TypeScript — הצהרות והגדרות",
    url: "https://www.typescriptlang.org/tsconfig/",
    topics: ["typescript", "tsconfig", "compiler", "types"],
    excerptEn:
      "Official tsconfig and compiler options reference for TypeScript projects.",
  },

  // —— Python ——
  {
    id: "python-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "python",
    titleEn: "Python 3 documentation",
    titleHe: "תיעוד Python 3",
    url: "https://docs.python.org/3/",
    topics: ["python", "py", "cpython", "stdlib", "pep"],
    excerptEn:
      "Official Python 3 language and standard library documentation (python.org).",
  },
  {
    id: "python-tutorial",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "python",
    titleEn: "The Python Tutorial",
    titleHe: "מדריך Python הרשמי",
    url: "https://docs.python.org/3/tutorial/",
    topics: ["python", "tutorial", "beginner", "language"],
    excerptEn:
      "Official Python Tutorial — authoritative introduction maintained by the Python Software Foundation.",
  },
  {
    id: "python-peps",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "python",
    titleEn: "Python Enhancement Proposals (PEPs)",
    titleHe: "הצעות שיפור לפייתון (PEPs)",
    url: "https://peps.python.org/",
    topics: ["python", "pep", "style", "packaging", "typing"],
    excerptEn:
      "Python Enhancement Proposals — process and language design standards for Python.",
  },

  // —— Java ——
  {
    id: "oracle-java-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "java",
    titleEn: "Oracle Java SE Documentation",
    titleHe: "תיעוד Oracle Java SE",
    url: "https://docs.oracle.com/en/java/javase/",
    topics: ["java", "jvm", "jdk", "se", "oracle"],
    excerptEn:
      "Official Oracle Java SE documentation — language, JDK tools, and core APIs.",
  },
  {
    id: "oracle-java-tutorials",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "java",
    titleEn: "Oracle Java Tutorials",
    titleHe: "מדריכי Oracle Java",
    url: "https://docs.oracle.com/javase/tutorial/",
    topics: ["java", "tutorial", "oop", "collections", "concurrency"],
    excerptEn:
      "Official Oracle Java Tutorials covering language fundamentals and core libraries.",
  },
  {
    id: "openjdk",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "java",
    titleEn: "OpenJDK",
    titleHe: "OpenJDK",
    url: "https://openjdk.org/",
    topics: ["java", "openjdk", "jvm", "hotspot"],
    excerptEn:
      "OpenJDK project site — open-source reference implementation of the Java Platform.",
  },

  // —— C / C++ ——
  {
    id: "cppreference",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "cpp",
    titleEn: "cppreference.com — C++ reference",
    titleHe: "cppreference — מדריך C++",
    url: "https://en.cppreference.com/w/",
    topics: ["cpp", "c++", "stl", "templates", "standard-library", "c"],
    excerptEn:
      "Community-maintained C and C++ standard library reference widely used alongside ISO drafts.",
  },
  {
    id: "iso-wg21",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cpp",
    titleEn: "ISO C++ Committee (WG21)",
    titleHe: "ועדת ISO ל־C++ (WG21)",
    url: "https://www.open-std.org/jtc1/sc22/wg21/",
    topics: ["cpp", "c++", "iso", "standard", "wg21"],
    excerptEn:
      "ISO/IEC JTC1/SC22/WG21 — official C++ standards committee working documents portal.",
  },
  {
    id: "isocpp",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cpp",
    titleEn: "Standard C++ Foundation",
    titleHe: "קרן Standard C++",
    url: "https://isocpp.org/",
    topics: ["cpp", "c++", "guidelines", "standard"],
    excerptEn:
      "isocpp.org — Standard C++ Foundation site with links to the standard and Core Guidelines.",
  },

  // —— C# / .NET ——
  {
    id: "dotnet-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "csharp",
    titleEn: "Microsoft .NET documentation",
    titleHe: "תיעוד Microsoft .NET",
    url: "https://learn.microsoft.com/en-us/dotnet/",
    topics: ["csharp", "c#", "dotnet", ".net", "aspnet"],
    excerptEn:
      "Official Microsoft Learn documentation for .NET and the C# language.",
  },
  {
    id: "csharp-language",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "csharp",
    titleEn: "C# language reference",
    titleHe: "מדריך שפת C#",
    url: "https://learn.microsoft.com/en-us/dotnet/csharp/",
    topics: ["csharp", "c#", "language", "dotnet"],
    excerptEn:
      "Official C# language guide and reference on Microsoft Learn.",
  },

  // —— Go / Rust ——
  {
    id: "go-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "go",
    titleEn: "The Go Programming Language",
    titleHe: "שפת התכנות Go",
    url: "https://go.dev/doc/",
    topics: ["go", "golang", "concurrency", "modules"],
    excerptEn:
      "Official Go documentation (go.dev) — language spec, effective Go, and modules.",
  },
  {
    id: "rust-book",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "rust",
    titleEn: "The Rust Programming Language (official book)",
    titleHe: "ספר Rust הרשמי",
    url: "https://doc.rust-lang.org/book/",
    topics: ["rust", "ownership", "cargo", "memory-safety"],
    excerptEn:
      "Official Rust Book — primary learning and reference path for the Rust language.",
  },

  // —— Web UI / design systems (a11y + standards) ——
  {
    id: "wcag22",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "web_ui",
    titleEn: "WCAG 2.2",
    titleHe: "WCAG 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
    topics: ["accessibility", "a11y", "wcag", "ui", "design", "web"],
    excerptEn:
      "W3C Web Content Accessibility Guidelines 2.2 — normative accessibility standard for UI.",
  },
  {
    id: "wai-aria-apg",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "web_ui",
    titleEn: "WAI-ARIA Authoring Practices Guide",
    titleHe: "מדריך WAI-ARIA Authoring Practices",
    url: "https://www.w3.org/WAI/ARIA/apg/",
    topics: ["aria", "accessibility", "ui", "patterns", "design"],
    excerptEn:
      "W3C WAI-ARIA Authoring Practices — official patterns for accessible UI components.",
  },
  {
    id: "mdn-css",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "web_ui",
    titleEn: "MDN — CSS",
    titleHe: "MDN — CSS",
    url: "https://developer.mozilla.org/en-US/docs/Web/CSS",
    topics: ["css", "layout", "design", "responsive", "ui"],
    excerptEn:
      "MDN CSS reference — authoritative browser CSS documentation for UI layout and styling.",
  },
  {
    id: "mdn-html",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "web_ui",
    titleEn: "MDN — HTML",
    titleHe: "MDN — HTML",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTML",
    topics: ["html", "semantics", "forms", "ui", "web"],
    excerptEn:
      "MDN HTML reference — semantic markup and forms for web UI.",
  },

  // —— Game development (vendor engine docs — no single ISO for “game design”) ——
  {
    id: "unity-manual",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "game_dev",
    titleEn: "Unity User Manual",
    titleHe: "מדריך המשתמש של Unity",
    url: "https://docs.unity3d.com/Manual/index.html",
    topics: ["unity", "game", "gamedev", "csharp", "engine", "3d", "2d"],
    excerptEn:
      "Official Unity Manual — engine workflows for 2D/3D games, scripting, and pipelines.",
  },
  {
    id: "unity-scripting",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "game_dev",
    titleEn: "Unity Scripting API",
    titleHe: "ממשק הסקריפטים של Unity",
    url: "https://docs.unity3d.com/ScriptReference/",
    topics: ["unity", "csharp", "scripting", "api", "gamedev"],
    excerptEn:
      "Official Unity Scripting API reference for C# game code.",
  },
  {
    id: "unreal-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "game_dev",
    titleEn: "Unreal Engine Documentation",
    titleHe: "תיעוד Unreal Engine",
    url: "https://dev.epicgames.com/documentation/unreal-engine/",
    topics: ["unreal", "ue5", "game", "gamedev", "cpp", "blueprint"],
    excerptEn:
      "Official Epic Games Unreal Engine documentation — C++, Blueprints, and pipelines.",
  },
  {
    id: "godot-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "game_dev",
    titleEn: "Godot Engine documentation",
    titleHe: "תיעוד מנוע Godot",
    url: "https://docs.godotengine.org/",
    topics: ["godot", "gdscript", "game", "gamedev", "2d", "3d"],
    excerptEn:
      "Official Godot Engine documentation — GDScript, scenes, and multi-platform game development.",
  },

  // —— Cybersecurity ——
  {
    id: "owasp-top10",
    kind: "SECURITY_ADVISORY",
    domain: "cybersecurity",
    titleEn: "OWASP Top 10",
    titleHe: "OWASP Top 10",
    url: "https://owasp.org/www-project-top-ten/",
    topics: ["owasp", "security", "cyber", "web", "vulnerabilities", "appsec"],
    excerptEn:
      "OWASP Top Ten — consensus list of the most critical web application security risks.",
  },
  {
    id: "owasp-asvs",
    kind: "SECURITY_ADVISORY",
    domain: "cybersecurity",
    titleEn: "OWASP ASVS",
    titleHe: "OWASP ASVS",
    url: "https://owasp.org/www-project-application-security-verification-standard/",
    topics: ["owasp", "asvs", "security", "verification", "appsec"],
    excerptEn:
      "OWASP Application Security Verification Standard — requirements for secure applications.",
  },
  {
    id: "nist-sp800",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cybersecurity",
    titleEn: "NIST SP 800 series (CSRC)",
    titleHe: "סדרת NIST SP 800",
    url: "https://csrc.nist.gov/publications/sp800",
    topics: ["nist", "sp800", "cyber", "government", "risk", "controls"],
    excerptEn:
      "NIST Computer Security Resource Center — Special Publication 800 series for cybersecurity controls.",
  },
  {
    id: "nist-csf",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cybersecurity",
    titleEn: "NIST Cybersecurity Framework",
    titleHe: "מסגרת הסייבר של NIST",
    url: "https://www.nist.gov/cyberframework",
    topics: ["nist", "csf", "cyber", "framework", "governance"],
    excerptEn:
      "NIST Cybersecurity Framework — US government guidance for identifying and managing cyber risk.",
  },
  {
    id: "cisa",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cybersecurity",
    titleEn: "CISA — Cybersecurity & Infrastructure Security Agency",
    titleHe: "CISA — סוכנות אבטחת סייבר ותשתיות",
    url: "https://www.cisa.gov/",
    topics: ["cisa", "cyber", "government", "advisories", "infrastructure"],
    excerptEn:
      "US CISA — official cyber defense guidance, alerts, and best practices.",
  },
  {
    id: "il-incd",
    kind: "GOVERNMENT_OR_STANDARDS",
    domain: "cybersecurity",
    titleEn: "Israel National Cyber Directorate",
    titleHe: "מערך הסייבר הלאומי",
    url: "https://www.gov.il/en/departments/israel_national_cyber_directorate",
    topics: ["israel", "cyber", "gov.il", "incd", "government", "guidance"],
    excerptEn:
      "Israel National Cyber Directorate — official Israeli government cyber guidance. Not a substitute for counsel.",
  },

  // —— Databases ——
  {
    id: "postgres-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "databases",
    titleEn: "PostgreSQL documentation",
    titleHe: "תיעוד PostgreSQL",
    url: "https://www.postgresql.org/docs/current/",
    topics: ["sql", "postgres", "postgresql", "database", "rdbms"],
    excerptEn:
      "Official PostgreSQL documentation — SQL, administration, and extensions.",
  },
  {
    id: "sqlite-docs",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "databases",
    titleEn: "SQLite documentation",
    titleHe: "תיעוד SQLite",
    url: "https://www.sqlite.org/docs.html",
    topics: ["sql", "sqlite", "database", "embedded"],
    excerptEn:
      "Official SQLite documentation — embedded SQL database engine.",
  },

  // —— Systems / OS ——
  {
    id: "linux-man-pages",
    kind: "OFFICIAL_VENDOR_DOCS",
    domain: "systems",
    titleEn: "Linux man-pages project",
    titleHe: "פרויקט דפי ה-man של Linux",
    url: "https://www.kernel.org/doc/man-pages/",
    topics: ["linux", "posix", "syscalls", "systems", "unix"],
    excerptEn:
      "Linux man-pages project — authoritative documentation for Linux system calls and C library interfaces.",
  },

  // —— University CS / cyber portals (authorized education, not language specs) ——
  {
    id: "mit-ocw-cs",
    kind: "UNIVERSITY",
    domain: "systems",
    titleEn: "MIT OpenCourseWare — Electrical Engineering & Computer Science",
    titleHe: "MIT OCW — הנדסת חשמל ומדעי המחשב",
    url: "https://ocw.mit.edu/search/?d=Electrical%20Engineering%20and%20Computer%20Science",
    topics: ["university", "mit", "cs", "algorithms", "systems", "education"],
    excerptEn:
      "MIT OpenCourseWare EECS catalog — university course materials for computer science and engineering.",
  },
  {
    id: "stanford-cs",
    kind: "UNIVERSITY",
    domain: "cybersecurity",
    titleEn: "Stanford University — Computer Science",
    titleHe: "אוניברסיטת סטנפורד — מדעי המחשב",
    url: "https://cs.stanford.edu/",
    topics: ["university", "stanford", "cs", "research", "education"],
    excerptEn:
      "Stanford Computer Science department — university research and educational programs in CS and related fields.",
  },
  {
    id: "technion-cs",
    kind: "UNIVERSITY",
    domain: "systems",
    titleEn: "Technion — Faculty of Computer Science",
    titleHe: "הטכניון — הפקולטה למדעי המחשב",
    url: "https://www.cs.technion.ac.il/",
    topics: ["university", "technion", "cs", "israel", "education"],
    excerptEn:
      "Technion Faculty of Computer Science — Israeli research university CS faculty portal.",
  },
  {
    id: "tau-cs",
    kind: "UNIVERSITY",
    domain: "systems",
    titleEn: "Tel Aviv University — Blavatnik School of Computer Science",
    titleHe: "אוניברסיטת תל אביב — בית הספר למדעי המחשב",
    url: "https://en-exact-sciences.tau.ac.il/computer-science",
    topics: ["university", "tau", "cs", "israel", "education"],
    excerptEn:
      "Tel Aviv University Blavatnik School of Computer Science — university CS education and research.",
  },
];

/** Hostname from an http(s) URL without relying on the DOM `URL` global. */
export function httpUrlHostname(value: string): string | null {
  const match = /^https?:\/\/([^/?#]+)/i.exec(value.trim());
  const host = match?.[1];
  return host ? host.toLowerCase() : null;
}

/** Hostnames (and parent suffixes) allowed for agent-facing tech knowledge. */
export function verifiedTechSourceHosts(): readonly string[] {
  const hosts = new Set<string>();
  for (const s of VERIFIED_TECH_SOURCES) {
    const host = httpUrlHostname(s.url);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/**
 * True when URL hostname matches the verified allow-list (exact or subdomain).
 * Agents / ingestion must reject non-matching external knowledge.
 */
export function isAuthorizedVerifiedTechUrl(url: string): boolean {
  const hostname = httpUrlHostname(url);
  if (!hostname) return false;
  return verifiedTechSourceHosts().some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/** Downloadable allow-list pack for offline / handoff (JSON). */
export function buildVerifiedTechSourcesPack(generatedAt = new Date().toISOString()): {
  schema: "atlas.verified-tech-sources.v1";
  policy: string;
  generatedAt: string;
  count: number;
  domains: readonly TechSourceDomain[];
  hosts: readonly string[];
  items: readonly VerifiedTechSource[];
} {
  return {
    schema: "atlas.verified-tech-sources.v1",
    policy:
      "Authorized verified knowledge only — official vendor docs, standards, government cyber, university CS. Agents must refuse or mark INSUFFICIENT_EVIDENCE outside this allow-list.",
    generatedAt,
    count: VERIFIED_TECH_SOURCES.length,
    domains: TECH_SOURCE_DOMAINS,
    hosts: verifiedTechSourceHosts(),
    items: VERIFIED_TECH_SOURCES,
  };
}

/** Human-readable markdown for the same pack. */
export function buildVerifiedTechSourcesMarkdown(
  generatedAt = new Date().toISOString(),
): string {
  const pack = buildVerifiedTechSourcesPack(generatedAt);
  const lines = [
    "# Atlas — Verified / authorized tech sources",
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    pack.policy,
    "",
    `Count: ${pack.count}`,
    "",
    "## Sources",
    "",
  ];
  for (const item of pack.items) {
    lines.push(`### ${item.titleEn}`);
    lines.push(`- Hebrew: ${item.titleHe}`);
    lines.push(`- Kind: ${item.kind}`);
    lines.push(`- Domain: ${item.domain}`);
    lines.push(`- URL: ${item.url}`);
    lines.push(`- Topics: ${item.topics.join(", ")}`);
    lines.push(`- Note: ${item.excerptEn}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Map allow-list entries into Knowledge Fabric corpus documents. */
export function verifiedTechSourcesAsCorpusSeed(): readonly {
  id: string;
  title: string;
  sourceClass: string;
  url: string;
  excerpt: string;
  topics: readonly string[];
}[] {
  return VERIFIED_TECH_SOURCES.map((s) => ({
    id: `kf_tech_${s.id}`,
    title: s.titleEn,
    sourceClass: s.kind,
    url: s.url,
    excerpt: `${s.excerptEn} Topics: ${s.topics.join(", ")}. Cite ${s.url}.`,
    topics: s.topics,
  }));
}
